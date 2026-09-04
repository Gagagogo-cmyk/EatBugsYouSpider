package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// OllamaClient is a thin wrapper around Ollama's local HTTP API
// (https://github.com/ollama/ollama/blob/main/docs/api.md). It never touches
// the target website itself -- it only ever sees text the crawler hands it.
type OllamaClient struct {
	BaseURL string
	Model   string
	HTTP    *http.Client
}

// NewOllamaClient builds a client for a local Ollama server. timeout should
// be generous: the first call after `ollama serve` starts (or after a model
// hasn't been used in a while) pays a one-off cost to load the model into
// memory, on top of normal generation time -- on CPU/Metal inference on a
// laptop, a single extraction call over a full page of event listings can
// easily take a couple of minutes. If timeout <= 0, it defaults to 5 minutes.
func NewOllamaClient(baseURL, model string, timeout time.Duration) *OllamaClient {
	if timeout <= 0 {
		timeout = 5 * time.Minute
	}
	return &OllamaClient{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Model:   model,
		HTTP:    &http.Client{Timeout: timeout},
	}
}

type ollamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ollamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []ollamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Format   string              `json:"format,omitempty"`
	Options  map[string]any      `json:"options,omitempty"`
}

type ollamaChatResponse struct {
	Message ollamaChatMessage `json:"message"`
	Done    bool              `json:"done"`
}

// chatJSON sends a system+user prompt to Ollama, requesting strict JSON output,
// and returns the raw assistant content. Callers are responsible for unmarshaling
// it into their own expected shape (navigator decision vs. extracted events).
func (c *OllamaClient) chatJSON(systemPrompt, userPrompt string) (string, error) {
	reqBody := ollamaChatRequest{
		Model: c.Model,
		Messages: []ollamaChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Stream: false,
		Format: "json",
		Options: map[string]any{
			"temperature": 0.1,
			// Hard ceiling on generated tokens -- without this, a confusing
			// page (or a model that gets stuck repeating itself) has no
			// upper bound on how long generation can run. 2048 turned out
			// too tight for a real events page with many listings (it cut
			// the JSON off mid-array); 8192 gives a venue page with dozens
			// of events room to fully generate, while still bounding the
			// worst case to a few minutes, not forever. extractEvents also
			// has a fallback that salvages whatever complete events made it
			// out even if a still-longer page hits this ceiling.
			"num_predict": 8192,
			// Must comfortably exceed prompt tokens + num_predict, or
			// generation gets cut short even before hitting num_predict.
			// Our prompts are usually well under 2000 tokens, so 16384
			// leaves generous headroom for both.
			"num_ctx": 16384,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshaling ollama request: %w", err)
	}

	resp, err := c.HTTP.Post(c.BaseURL+"/api/chat", "application/json", bytes.NewReader(body))
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return "", fmt.Errorf("ollama call to %s timed out after %s -- the model may still be loading into memory for the first time, or the page has a lot of text to process. Try pre-warming it first with `ollama run %s` in another terminal, or raise -ollama-timeout: %w",
				c.BaseURL, c.HTTP.Timeout, c.Model, err)
		}
		return "", fmt.Errorf("calling ollama at %s (is `ollama serve` running?): %w", c.BaseURL, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading ollama response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ollama returned status %d: %s", resp.StatusCode, truncate(string(respBytes), 500))
	}

	var parsed ollamaChatResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return "", fmt.Errorf("parsing ollama envelope: %w (raw: %s)", err, truncate(string(respBytes), 500))
	}

	return parsed.Message.Content, nil
}

// extractJSONBlock pulls the first {...} or [...] block out of a model response,
// as a defensive fallback for models that occasionally wrap JSON in prose
// (e.g. "Here is the JSON: {...}") despite format:"json" being requested.
func extractJSONBlock(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	if s[0] == '{' || s[0] == '[' {
		return s
	}
	for _, pair := range [][2]byte{{'{', '}'}, {'[', ']'}} {
		start := strings.IndexByte(s, pair[0])
		if start == -1 {
			continue
		}
		end := strings.LastIndexByte(s, pair[1])
		if end > start {
			return s[start : end+1]
		}
	}
	return s
}
