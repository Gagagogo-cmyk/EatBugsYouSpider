#pragma once
// Gnumbat accounts: log in / register / forgot password against the Gnumbat backend
// (src/backend/routes/auth.js -- POST /auth/login, /auth/register, /auth/forgot, GET /auth/me).
//
//   Account   -- the state + the HTTP calls (background thread, results back on the message thread).
//                The login token is kept in settings.json ("auth_token" / "auth_username"); the
//                password itself is never stored.
//   LoginBar  -- the two white fields centred in the top line (between "Reaper / MASTER" and
//                "model / x"). What they ask for depends on the step:
//                  log in           Username        Password
//                  register, step 1 Email address   Username          (Enter ->)
//                  register, step 2 Password        Password again    (Enter -> account created, logged in)
//                Once logged in the fields give way to "Yo <username>!".
//
// The backend's address is settings.json "backend_url" (default http://localhost:3000).
#include <juce_gui_basics/juce_gui_basics.h>
#include "UiHost.h"
#include "../../core/Settings.h"
#include <atomic>
#include <memory>

namespace gnumbat::ui
{
    class Account : public juce::ChangeBroadcaster
    {
    public:
        enum class Mode { login, registerIdentity, registerPassword };

        Account (Settings& settings, UiHost& host);
        ~Account() override;

        bool loggedIn() const noexcept { return token.isNotEmpty(); }
        const juce::String& username() const noexcept { return user; }
        Mode mode() const noexcept { return stepMode; }
        bool busy() const noexcept { return pending > 0; }

        void login (const juce::String& username, const juce::String& password);
        void beginRegister();                                                   // fields -> EMAIL ADDRESS / USERNAME
        void submitIdentity (const juce::String& email, const juce::String& username);   // -> PASSWORD / PASSWORD AGAIN
        void submitPasswords (const juce::String& password, const juce::String& again);  // -> create the account
        void backToLogin();                                                     // leave the register steps
        void forgotPassword (const juce::String& usernameOrEmail);              // backend emails a reset link
        void logout();
        void validateStoredLogin();                                             // on startup: is the saved token still good?

        juce::String backendUrl() const;
        static bool looksLikeEmail (const juce::String&);

    private:
        Settings& settings;
        UiHost& host;
        juce::String token, user, regEmail, regUser;
        Mode stepMode = Mode::login;
        int pending = 0;
        std::shared_ptr<std::atomic<bool>> alive = std::make_shared<std::atomic<bool>> (true);

        void setLoggedIn (const juce::String& token, const juce::String& username);
        void persist();
        /** POST (body non-void) or GET (body void) `path`; `done (httpStatus, json)` on the message
            thread. Status 0 = the backend couldn't be reached. */
        void request (const juce::String& path, const juce::var& body, std::function<void (int, juce::var)> done, bool withToken = false);
    };

    class LoginBar : public juce::Component, private juce::ChangeListener, private juce::KeyListener
    {
    public:
        explicit LoginBar (Account&);
        ~LoginBar() override;
        void paint (juce::Graphics&) override;
        void resized() override;
        juce::String firstField() const { return first.getText().trim(); }
        void focusFirst() { if (first.isShowing()) first.grabKeyboardFocus(); }
        /** Preferred width for the two fields (the editor centres this bar in the top line). */
        static int preferredWidth();

    private:
        Account& account;
        juce::TextEditor first, second;
        // "Username" / "Password" etc.: two identical read-only editors sitting right behind the real
        // ones, so the hint is rendered by the very same text layout the typed text uses -- same
        // pixel, by construction.
        juce::TextEditor firstHintView, secondHintView;
        juce::String firstHint, secondHint;
        void syncHints();
        void changeListenerCallback (juce::ChangeBroadcaster*) override;
        bool keyPressed (const juce::KeyPress&, juce::Component*) override;
        void submit();
        void refresh();
        Account::Mode shownMode = Account::Mode::login;
        bool shownLoggedIn = false;
    };
}
