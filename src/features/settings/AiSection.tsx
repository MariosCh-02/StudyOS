import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, ListRestart, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { qk } from "@/hooks/queries";
import {
  aiDeleteKey,
  aiHasKey,
  aiListModels,
  aiSetKey,
  isTauri,
} from "@/lib/native";
import {
  AI_PROVIDERS,
  PROVIDER_LABELS,
  SUGGESTED_MODELS,
  type AiProvider,
  type RemoteProvider,
} from "@/domain/aiPrompts";
import { KEY_STORE } from "@/lib/platform";
import { setSetting, type SettingsMap } from "@/services/settings";
import { aiTestConnection } from "@/services/ai";
import { Section } from "./Section";

const PRIVACY: Record<RemoteProvider, string> = {
  openai:
    "When you start an AI action, the text for that action is sent to OpenAI under your own API key and OpenAI's terms. Nothing is sent automatically.",
  anthropic:
    "When you start an AI action, the text for that action is sent to Anthropic under your own API key and Anthropic's terms. Nothing is sent automatically.",
  ollama:
    "Ollama runs models on your own computer (or a server you choose), so your notes don't leave it.",
};

function KeyField({ provider }: { provider: RemoteProvider }) {
  const client = useQueryClient();
  const hasKey = useQuery({
    queryKey: ["aiKey", provider],
    queryFn: () => aiHasKey(provider),
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setKey("");
    setError(null);
  }, [provider]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setKey("");
      await client.invalidateQueries({ queryKey: ["aiKey", provider] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (hasKey.data) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-success">
          <CheckCircle2 className="size-4" aria-hidden /> API key saved in {KEY_STORE}
        </span>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => void act(() => aiDeleteKey(provider))}
        >
          Remove key
        </Button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    );
  }
  return (
    <div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => aiSetKey(provider, key));
        }}
      >
        <TextField
          label={`${PROVIDER_LABELS[provider]} API key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="flex-1"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          error={error ?? undefined}
        />
        <Button
          type="submit"
          className={error ? "mb-5" : undefined}
          icon={<KeyRound className="size-4" />}
          loading={busy}
          disabled={!key.trim()}
        >
          Save key
        </Button>
      </form>
      <p className="mt-1 text-xs text-subtle">
        Stored in {KEY_STORE}, never in StudyOS data or the cloud sync.
      </p>
    </div>
  );
}

export function AiSection({ settings }: { settings: SettingsMap }) {
  const client = useQueryClient();
  const listId = useId();
  const provider = settings.aiProvider;
  const [model, setModel] = useState(settings.aiModel);
  const [url, setUrl] = useState(settings.aiOllamaUrl);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<"list" | "test" | null>(null);

  useEffect(() => {
    setModel(settings.aiModel);
  }, [settings.aiModel]);
  useEffect(() => {
    setUrl(settings.aiOllamaUrl);
  }, [settings.aiOllamaUrl]);
  useEffect(() => {
    setModels([]);
    setStatus(null);
  }, [provider]);

  const save = async <K extends "aiProvider" | "aiModel" | "aiOllamaUrl">(
    key: K,
    value: SettingsMap[K],
  ) => {
    setStatus(null);
    try {
      await setSetting(key, value);
      await client.invalidateQueries({ queryKey: qk.settings });
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        ok: false,
      });
    }
  };

  const changeProvider = async (p: AiProvider) => {
    await save("aiProvider", p);
    // Start from a sensible model when switching providers.
    if (p !== "none" && p !== provider)
      await save("aiModel", SUGGESTED_MODELS[p][0] ?? "");
  };

  const listModels = async () => {
    setBusy("list");
    setStatus(null);
    try {
      const found = await aiListModels(provider, url);
      setModels(found);
      setStatus({
        text: found.length
          ? `${found.length} models available. Pick one in the Model field.`
          : provider === "ollama"
            ? "No models installed. Run e.g. `ollama pull llama3.2` first."
            : "No models were returned for this key.",
        ok: found.length > 0,
      });
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        ok: false,
      });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setStatus(null);
    try {
      const m = model.trim();
      if (m !== settings.aiModel) {
        await setSetting("aiModel", m);
        await client.invalidateQueries({ queryKey: qk.settings });
      }
      const reply = await aiTestConnection();
      setStatus({
        text: `Connected. ${m} replied: “${reply.slice(0, 60)}”`,
        ok: true,
      });
    } catch (err) {
      setStatus({
        text: err instanceof Error ? err.message : String(err),
        ok: false,
      });
    } finally {
      setBusy(null);
    }
  };

  const desktop = isTauri();
  const suggestions = [
    ...new Set([
      ...(provider === "none" ? [] : SUGGESTED_MODELS[provider]),
      ...models,
    ]),
  ];

  return (
    <Section
      title="AI (optional)"
      description={
        <>
          <p>
            Summaries, explanations, flashcards, quizzes, study plans and AI
            answers in Ask My Studies. StudyOS works fully without AI.
          </p>
          <p className="mt-2">
            Everything AI produces is labelled as AI-generated. Check it against
            your course material.
          </p>
        </>
      }
    >
      {!desktop ? (
        <p className="text-sm text-muted">
          AI features are available in the desktop app, where API keys can be
          stored securely.
        </p>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <SelectField
            label="Provider"
            value={provider}
            onChange={(e) => void changeProvider(e.target.value as AiProvider)}
            options={AI_PROVIDERS.map((p) => ({
              value: p,
              label: PROVIDER_LABELS[p],
            }))}
          />
          {provider !== "none" && (
            <>
              <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-muted">
                {PRIVACY[provider]}
              </p>
              {provider !== "ollama" && <KeyField provider={provider} />}
              {provider === "ollama" && (
                <TextField
                  label="Ollama address"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() =>
                    url.trim() !== settings.aiOllamaUrl &&
                    void save("aiOllamaUrl", url.trim())
                  }
                  hint="Install Ollama from ollama.com, then pull a model, e.g. ollama pull llama3.2."
                />
              )}
              <div className="flex items-end gap-2">
                <TextField
                  label="Model"
                  className="flex-1"
                  list={listId}
                  spellCheck={false}
                  value={model}
                  placeholder={
                    provider === "openai"
                      ? "Use List models to see what your key can use"
                      : ""
                  }
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() =>
                    model.trim() !== settings.aiModel &&
                    void save("aiModel", model.trim())
                  }
                  onKeyDown={(e) =>
                    e.key === "Enter" && void save("aiModel", model.trim())
                  }
                />
                <datalist id={listId}>
                  {suggestions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <Button
                  icon={<ListRestart className="size-4" />}
                  loading={busy === "list"}
                  onClick={() => void listModels()}
                >
                  List models
                </Button>
                <Button
                  icon={<PlugZap className="size-4" />}
                  loading={busy === "test"}
                  disabled={!model.trim()}
                  onClick={() => void test()}
                >
                  Test
                </Button>
              </div>
              {status && (
                <p
                  className={
                    status.ok ? "text-sm text-success" : "text-sm text-danger"
                  }
                >
                  {status.text}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
}
