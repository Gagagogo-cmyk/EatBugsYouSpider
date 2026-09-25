#include "Account.h"
#include "Theme.h"
#include "../../core/JsonIo.h"

namespace gnumbat::ui
{
    using juce::String;
    using juce::var;

    // ================================================================================== Account
    Account::Account (Settings& s, UiHost& h) : settings (s), host (h)
    {
        token = settings.get ("auth_token", "").toString();
        user = settings.get ("auth_username", "").toString();
        if (token.isEmpty()) user = {};
    }

    Account::~Account() { alive->store (false); }

    String Account::backendUrl() const
    {
        auto u = settings.get ("backend_url", "").toString().trim();
        if (u.isEmpty()) u = "http://localhost:3000";
        return u.trimCharactersAtEnd ("/");
    }

    bool Account::looksLikeEmail (const String& s)
    {
        const auto t = s.trim();
        const int at = t.indexOfChar ('@');
        return at > 0 && t.indexOfChar (at + 1, '.') > at + 1 && ! t.endsWithChar ('.') && ! t.containsAnyOf (" \t");
    }

    void Account::persist()
    {
        settings.set ("auth_token", token);
        settings.set ("auth_username", user);
        // Merge into the file rather than overwrite it wholesale (the plugin's in-memory settings
        // copy may be older than what's on disk).
        auto onDisk = Settings::load();
        onDisk.set ("auth_token", token);
        onDisk.set ("auth_username", user);
        onDisk.save();
    }

    void Account::setLoggedIn (const String& t, const String& u)
    {
        token = t; user = u;
        stepMode = Mode::login;
        regEmail = regUser = {};
        persist();
        sendChangeMessage();
    }

    void Account::request (const String& path, const var& body, std::function<void (int, var)> done, bool withToken)
    {
        ++pending;
        sendChangeMessage();
        const auto url = backendUrl() + path;
        const auto bodyText = body.isVoid() ? String() : juce::JSON::toString (body, true);
        const auto auth = withToken ? token : String();
        auto weak = alive;
        juce::Thread::launch ([this, weak, url, bodyText, auth, done]
        {
            int status = 0;
            String text;
            {
                juce::URL u (url);
                String headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
                if (auth.isNotEmpty()) headers << "Authorization: Bearer " << auth << "\r\n";
                const bool post = bodyText.isNotEmpty();
                if (post) u = u.withPOSTData (bodyText);
                auto opts = juce::URL::InputStreamOptions (post ? juce::URL::ParameterHandling::inPostData
                                                                : juce::URL::ParameterHandling::inAddress)
                                .withExtraHeaders (headers)
                                .withConnectionTimeoutMs (8000)
                                .withStatusCode (&status);
                if (auto in = u.createInputStream (opts)) text = in->readEntireStreamAsString();
                else status = 0;
            }
            var json;
            juce::JSON::parse (text, json);
            juce::MessageManager::callAsync ([this, weak, status, json, done]
            {
                if (! weak->load()) return;
                --pending;
                done (status, json);
                sendChangeMessage();
            });
        });
    }

    static String errorOf (int status, const var& json, const String& fallback)
    {
        if (status == 0) return "can't reach the Gnumbat server";
        const auto e = json::getString (json, "error");
        return e.isNotEmpty() ? e : fallback + " (" + String (status) + ")";
    }

    void Account::login (const String& username, const String& password)
    {
        if (username.trim().isEmpty() || password.isEmpty()) { host.notify ("enter your username and password", true); return; }
        request ("/auth/login", json::object ({ { "username", username.trim() }, { "password", password } }),
                 [this] (int status, var j)
                 {
                     if (status == 200 && json::getString (j, "token").isNotEmpty())
                     {
                         setLoggedIn (json::getString (j, "token"), json::getString (j, "user/username"));
                         host.notify ("Yo " + user + "!");
                     }
                     else host.notify (status == 401 ? String ("wrong username or password") : errorOf (status, j, "log in failed"), true);
                 });
    }

    void Account::beginRegister()
    {
        stepMode = Mode::registerIdentity;
        regEmail = regUser = {};
        sendChangeMessage();
    }

    void Account::submitIdentity (const String& email, const String& username)
    {
        if (! looksLikeEmail (email)) { host.notify ("enter a valid email address", true); return; }
        if (username.trim().length() < 2 || username.trim().containsAnyOf (" \t")) { host.notify ("choose a username (no spaces)", true); return; }
        regEmail = email.trim();
        regUser = username.trim();
        stepMode = Mode::registerPassword;
        sendChangeMessage();
    }

    void Account::submitPasswords (const String& password, const String& again)
    {
        if (password != again) { host.notify ("the two passwords are not the same", true); return; }
        if (password.length() < 8) { host.notify ("the password needs at least 8 characters", true); return; }
        request ("/auth/register", json::object ({ { "username", regUser }, { "email", regEmail }, { "password", password } }),
                 [this] (int status, var j)
                 {
                     if (status == 200 && json::getString (j, "token").isNotEmpty())
                     {
                         setLoggedIn (json::getString (j, "token"), json::getString (j, "user/username"));
                         host.notify ("account created -- Yo " + user + "!");
                     }
                     else
                     {
                         host.notify (errorOf (status, j, "register failed"), true);
                         if (status == 409) { stepMode = Mode::registerIdentity; sendChangeMessage(); }   // name/email taken: back to step 1
                     }
                 });
    }

    void Account::backToLogin()
    {
        stepMode = Mode::login;
        regEmail = regUser = {};
        sendChangeMessage();
    }

    void Account::forgotPassword (const String& login)
    {
        if (login.trim().isEmpty()) { host.notify ("type your username or email in the first box, then click forgot password", true); return; }
        request ("/auth/forgot", json::object ({ { "login", login.trim() } }),
                 [this] (int status, var j)
                 {
                     if (status == 200) host.notify ("if that account exists, a reset link is on its way to its email");
                     else host.notify (errorOf (status, j, "forgot password failed"), true);
                 });
    }

    void Account::logout()
    {
        const auto who = user;
        token = user = {};
        stepMode = Mode::login;
        persist();
        host.notify ("logged out" + (who.isNotEmpty() ? " -- later " + who : String()));
        sendChangeMessage();
    }

    void Account::validateStoredLogin()
    {
        if (token.isEmpty()) return;
        request ("/auth/me", {}, [this] (int status, var j)
        {
            // 401: the saved login expired or was revoked -> logged out. Unreachable server (0):
            // stay logged in -- being offline isn't a reason to lose the login.
            if (status == 401) { token = user = {}; persist(); sendChangeMessage(); }
            else if (status == 200 && json::getString (j, "user/username").isNotEmpty() && json::getString (j, "user/username") != user)
            { user = json::getString (j, "user/username"); persist(); sendChangeMessage(); }
        }, true);
    }

    // ================================================================================= LoginBar
    static void styleField (juce::TextEditor& t)
    {
        // No box at all: just grey text on the black background (placeholder and typing alike).
        t.setFont (mono());
        t.setMultiLine (false);
        t.setReturnKeyStartsNewLine (false);
        t.setJustification (juce::Justification::centredLeft);
        t.setIndents (6, 0);
        t.setColour (juce::TextEditor::backgroundColourId, col::bg);
        t.setColour (juce::TextEditor::textColourId, col::text);
        t.setColour (juce::TextEditor::highlightColourId, col::grey);
        t.setColour (juce::TextEditor::highlightedTextColourId, col::bg);
        t.setColour (juce::TextEditor::outlineColourId, juce::Colours::transparentBlack);
        t.setColour (juce::TextEditor::focusedOutlineColourId, juce::Colours::transparentBlack);
        t.setColour (juce::CaretComponent::caretColourId, col::white);
    }

    LoginBar::LoginBar (Account& a) : account (a)
    {
        for (auto* h : { &firstHintView, &secondHintView })
        {
            styleField (*h);
            h->setReadOnly (true);
            h->setCaretVisible (false);
            h->setInterceptsMouseClicks (false, false);
            h->setWantsKeyboardFocus (false);
            h->setColour (juce::TextEditor::textColourId, col::dim);
            addChildComponent (*h);
        }
        for (auto* t : { &first, &second })
        {
            styleField (*t);
            t->setColour (juce::TextEditor::backgroundColourId, juce::Colours::transparentBlack);   // hint shows through
            t->onReturnKey = [this] { submit(); };
            t->onEscapeKey = [this] { if (account.mode() != Account::Mode::login) account.backToLogin(); else unfocusAllComponents(); };
            t->addKeyListener (this);
            t->onTextChange = [this] { syncHints(); };   // fields never move; only the hint hides
            addChildComponent (*t);
        }
        account.addChangeListener (this);
        shownMode = account.mode();
        shownLoggedIn = ! account.loggedIn();   // force the first refresh
        refresh();
    }

    LoginBar::~LoginBar() { account.removeChangeListener (this); }

    namespace
    {
        // How far the second field ("Password", or whatever it's standing in for -- see
        // LoginBar::resized()) sits right of where it'd otherwise land, on request. preferredWidth()
        // below has to grow by the same amount, or the bar gets allotted too little room and
        // second's own box (which starts at the shifted x2) gets squeezed against the right edge.
        constexpr int kPasswordShift = 50;
    }

    int LoginBar::preferredWidth() { return 2 * (juce::GlyphArrangement::getStringWidthInt (mono(), "Password again") + 26) + 8 + kPasswordShift; }

    void LoginBar::refresh()
    {
        const bool in = account.loggedIn();
        const auto m = account.mode();
        const bool changed = in != shownLoggedIn || m != shownMode;
        shownLoggedIn = in; shownMode = m;
        first.setVisible (! in);
        second.setVisible (! in);
        if (! in && changed)
        {
            const bool secrets = m == Account::Mode::registerPassword;
            const bool loginMode = m == Account::Mode::login;
            first.clear();          // every step starts with two empty boxes
            second.clear();
            first.setPasswordCharacter (secrets ? (juce::juce_wchar) 0x2022 : 0);
            second.setPasswordCharacter ((secrets || loginMode) ? (juce::juce_wchar) 0x2022 : 0);
            firstHint  = loginMode ? "Username" : m == Account::Mode::registerIdentity ? "Email address" : "Password";
            secondHint = loginMode ? "Password" : m == Account::Mode::registerIdentity ? "Username" : "Password again";
            // Keep them on the editors too (invisible) so anything asking a field what it's for still can.
            first.setTextToShowWhenEmpty (firstHint, juce::Colours::transparentBlack);
            second.setTextToShowWhenEmpty (secondHint, juce::Colours::transparentBlack);
            if (! loginMode && isShowing()) first.grabKeyboardFocus();
        }
        resized();   // placeholders may have changed width
        syncHints();
        const bool busy = account.busy();
        first.setEnabled (! busy);
        second.setEnabled (! busy);
        repaint();
    }

    void LoginBar::changeListenerCallback (juce::ChangeBroadcaster*) { refresh(); }

    void LoginBar::submit()
    {
        switch (account.mode())
        {
            case Account::Mode::login:            account.login (first.getText(), second.getText()); break;
            case Account::Mode::registerIdentity: account.submitIdentity (first.getText(), second.getText()); break;
            case Account::Mode::registerPassword: account.submitPasswords (first.getText(), second.getText()); break;
        }
    }

    bool LoginBar::keyPressed (const juce::KeyPress& k, juce::Component* origin)
    {
        // Tab moves between the two boxes (instead of switching LIBRARY/MAP behind them).
        if (k.getKeyCode() == juce::KeyPress::tabKey)
        {
            (origin == &first ? second : first).grabKeyboardFocus();
            return true;
        }
        return false;
    }

    void LoginBar::resized()
    {
        // Fixed layout: the two hints ("Username"  "Password") are centred once, from their own
        // widths, and never move -- typing doesn't re-centre or resize anything. Each field starts
        // exactly at its hint; the first runs up to the second, the second to the bar's right edge
        // (longer input scrolls inside the field).
        const int hint1 = juce::GlyphArrangement::getStringWidthInt (mono(), firstHint);
        const int hint2 = juce::GlyphArrangement::getStringWidthInt (mono(), secondHint);
        const int pad = first.getLeftIndent() + first.getBorder().getLeft();   // text starts this far into a field
        constexpr int gap = 4;
        const int total = hint1 + gap + pad + hint2;
        const int textX = juce::jmax (0, (getWidth() - total) / 2);           // where "Username" is drawn
        const int x1 = juce::jmax (0, textX - pad);
        // Password nudged further right on request -- Username/first stays exactly where the
        // centring above puts it; first's own box just grows to cover the extra gap (invisible --
        // same background as the bar, no outline -- so it reads as empty space, not a wider field).
        const int x2 = textX + hint1 + gap + kPasswordShift;                   // field 2 box; its text lands at x2 + pad
        first.setBounds (x1, 0, juce::jmax (20, x2 - x1), getHeight());
        second.setBounds (x2, 0, juce::jmax (20, getWidth() - x2), getHeight());
        syncHints();
    }

    void LoginBar::syncHints()
    {
        const bool in = account.loggedIn();
        for (auto [field, view, hint] : { std::tuple<juce::TextEditor*, juce::TextEditor*, juce::String*> { &first, &firstHintView, &firstHint },
                                                                                                           { &second, &secondHintView, &secondHint } })
        {
            if (view->getText() != *hint) view->setText (*hint, false);
            view->setBounds (field->getBounds());
            view->setVisible (! in && field->getTotalNumChars() == 0);
        }
    }

    void LoginBar::paint (juce::Graphics& g)
    {
        if (! account.loggedIn()) return;
        g.setFont (mono());
        g.setColour (col::white);
        g.drawText ("Yo " + account.username() + "!", getLocalBounds(), juce::Justification::centred, true);
    }
}
