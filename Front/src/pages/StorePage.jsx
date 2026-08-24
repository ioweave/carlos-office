import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconBrain,
  IconKey,
  IconLock,
  IconPlus,
  IconRefresh,
  IconTool,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";

import api, { endpoints } from "../api";
import "../styles/credentials.scss";

const GOOGLE_WORKSPACE_TYPE = "google-workspace";
const GOOGLE_WORKSPACE_HOSTS = [
  "gmail.googleapis.com",
  "www.googleapis.com",
  "docs.googleapis.com",
  "sheets.googleapis.com",
  "slides.googleapis.com",
  "chat.googleapis.com",
  "keep.googleapis.com",
  "meet.googleapis.com",
];
const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/keep",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/meetings.space.settings",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

const defaultsForType = type => {
  if (type === "bearer" || type === GOOGLE_WORKSPACE_TYPE) {
    return { headerName: "Authorization", scheme: "Bearer" };
  }
  if (type === "basic") return { headerName: "Authorization", scheme: "Basic" };
  if (type === "api-key") return { headerName: "X-API-Key", scheme: "" };
  return { headerName: "Authorization", scheme: "" };
};

const emptyCredentialForm = () => ({
  service: "",
  type: "bearer",
  allowedHosts: "",
  headerName: "Authorization",
  scheme: "Bearer",
  subject: "",
  scopes: "",
  secret: "",
});

const credentialFormFrom = credential => ({
  service: credential.service,
  type: credential.type || "bearer",
  allowedHosts: (credential.allowedHosts || []).join("\n"),
  headerName: credential.headerName || "Authorization",
  scheme: credential.scheme || "",
  subject: credential.subject || "",
  scopes: (credential.scopes || []).join("\n"),
  secret: "",
});

const emptyVariableForm = () => ({ key: "", value: "", description: "" });
const variableFormFrom = variable => ({
  key: variable.key,
  value: variable.value ?? "",
  description: variable.description ?? "",
});

const parseLines = value => [...new Set(
  String(value || "")
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean),
)];

export default function StorePage() {
  const [section, setSection] = useState("credentials");
  const [loading, setLoading] = useState(true);

  const [credentials, setCredentials] = useState([]);
  const [selectedService, setSelectedService] = useState("");
  const [creatingCredential, setCreatingCredential] = useState(false);
  const [credentialForm, setCredentialForm] = useState(emptyCredentialForm);
  const [savingCredential, setSavingCredential] = useState(false);
  const [deletingCredential, setDeletingCredential] = useState(false);

  const [variables, setVariables] = useState([]);
  const [selectedVariableKey, setSelectedVariableKey] = useState("");
  const [creatingVariable, setCreatingVariable] = useState(false);
  const [variableForm, setVariableForm] = useState(emptyVariableForm);
  const [savingVariable, setSavingVariable] = useState(false);
  const [deletingVariable, setDeletingVariable] = useState(false);

  const [knowledge, setKnowledge] = useState({ facts: "", instructions: "" });
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [credentialResult, variableResult, knowledgeResult] = await Promise.allSettled([
      api.get(endpoints.credentials()),
      api.get(endpoints.variables()),
      api.get(endpoints.knowledge()),
    ]);

    if (credentialResult.status === "fulfilled") {
      const items = credentialResult.value.data || [];
      setCredentials(items);
      setSelectedService(current => current && items.some(item => item.service === current) ? current : "");
    } else {
      toast.error(credentialResult.reason?.response?.data?.error || "Could not load Credentials.");
    }

    if (variableResult.status === "fulfilled") {
      const items = variableResult.value.data || [];
      setVariables(items);
      setSelectedVariableKey(current => current && items.some(item => item.key === current) ? current : "");
    } else {
      toast.error(variableResult.reason?.response?.data?.error || "Could not load Workspace Variables.");
    }

    if (knowledgeResult.status === "fulfilled") {
      setKnowledge({
        facts: knowledgeResult.value.data?.facts ?? "",
        instructions: knowledgeResult.value.data?.instructions ?? "",
      });
    } else {
      toast.error(knowledgeResult.reason?.response?.data?.error || "Could not load Knowledge.");
    }

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedCredential = useMemo(
    () => credentials.find(item => item.service === selectedService) || null,
    [credentials, selectedService],
  );
  const selectedVariable = useMemo(
    () => variables.find(item => item.key === selectedVariableKey) || null,
    [variables, selectedVariableKey],
  );

  useEffect(() => {
    if (creatingCredential) return;
    setCredentialForm(selectedCredential ? credentialFormFrom(selectedCredential) : emptyCredentialForm());
  }, [creatingCredential, selectedCredential]);

  useEffect(() => {
    if (creatingVariable) return;
    setVariableForm(selectedVariable ? variableFormFrom(selectedVariable) : emptyVariableForm());
  }, [creatingVariable, selectedVariable]);

  const selectCredential = service => {
    setCreatingCredential(false);
    setSelectedService(service);
  };

  const startCreateCredential = () => {
    setSelectedService("");
    setCreatingCredential(true);
    setCredentialForm(emptyCredentialForm());
  };

  const updateCredential = (field, value) => setCredentialForm(current => ({ ...current, [field]: value }));

  const updateCredentialType = type => {
    const defaults = defaultsForType(type);
    setCredentialForm(current => ({
      ...current,
      type,
      ...defaults,
      ...(type === GOOGLE_WORKSPACE_TYPE ? {
        service: creatingCredential && !current.service.trim() ? "google-workspace" : current.service,
        allowedHosts: GOOGLE_WORKSPACE_HOSTS.join("\n"),
        scopes: current.scopes || GOOGLE_WORKSPACE_SCOPES.join("\n"),
      } : {}),
    }));
  };

  const saveCredential = async () => {
    const service = credentialForm.service.trim();
    const googleWorkspace = credentialForm.type === GOOGLE_WORKSPACE_TYPE;
    const allowedHosts = googleWorkspace ? GOOGLE_WORKSPACE_HOSTS : parseLines(credentialForm.allowedHosts);
    const scopes = googleWorkspace ? parseLines(credentialForm.scopes) : [];

    if (!service) return toast.error("Service name is required.");
    if (!allowedHosts.length) return toast.error("Add at least one allowed host.");
    if (creatingCredential && !credentialForm.secret.trim()) return toast.error("Secret is required for a new credential.");
    if (googleWorkspace && !credentialForm.subject.trim()) return toast.error("Workspace user email is required.");
    if (googleWorkspace && !scopes.length) return toast.error("Add at least one Google Workspace OAuth scope.");

    if (googleWorkspace && credentialForm.secret.trim()) {
      try {
        const parsed = JSON.parse(credentialForm.secret);
        if (parsed?.type !== "service_account" || !parsed.client_email || !parsed.private_key) {
          return toast.error("Paste a valid Google service-account JSON key.");
        }
      } catch {
        return toast.error("Service-account JSON is not valid JSON.");
      }
    }

    setSavingCredential(true);
    try {
      const response = await api.put(endpoints.credential(service), {
        type: credentialForm.type,
        allowedHosts,
        headerName: credentialForm.headerName.trim(),
        scheme: credentialForm.scheme.trim(),
        ...(googleWorkspace ? {
          subject: credentialForm.subject.trim(),
          scopes,
        } : {}),
        ...(credentialForm.secret ? { secret: credentialForm.secret } : {}),
      });
      const saved = response.data;
      setCredentials(current => [...current.filter(item => item.service !== saved.service), saved]
        .sort((left, right) => left.service.localeCompare(right.service)));
      setCreatingCredential(false);
      setSelectedService(saved.service);
      setCredentialForm(credentialFormFrom(saved));
      toast.success(`Credential ${saved.service} saved.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Credential.");
    } finally {
      setSavingCredential(false);
    }
  };

  const removeCredential = async () => {
    if (!selectedCredential || !window.confirm(`Delete credential ${selectedCredential.service}?`)) return;
    setDeletingCredential(true);
    try {
      await api.delete(endpoints.credential(selectedCredential.service));
      setCredentials(current => current.filter(item => item.service !== selectedCredential.service));
      setSelectedService("");
      setCredentialForm(emptyCredentialForm());
      toast.success(`Credential ${selectedCredential.service} deleted.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete Credential.");
    } finally {
      setDeletingCredential(false);
    }
  };

  const selectVariable = key => {
    setCreatingVariable(false);
    setSelectedVariableKey(key);
  };

  const startCreateVariable = () => {
    setSelectedVariableKey("");
    setCreatingVariable(true);
    setVariableForm(emptyVariableForm());
  };

  const updateVariable = (field, value) => setVariableForm(current => ({ ...current, [field]: value }));

  const saveVariable = async () => {
    const key = variableForm.key.trim();
    if (!key) return toast.error("Variable key is required.");
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)) {
      return toast.error("Variable key must start with a letter and use only letters, numbers, ., _, or -.");
    }

    setSavingVariable(true);
    try {
      const response = await api.put(endpoints.variable(key), {
        value: variableForm.value,
        description: variableForm.description.trim(),
      });
      const saved = response.data;
      setVariables(current => [...current.filter(item => item.key !== saved.key), saved]
        .sort((left, right) => left.key.localeCompare(right.key)));
      setCreatingVariable(false);
      setSelectedVariableKey(saved.key);
      setVariableForm(variableFormFrom(saved));
      toast.success(`Workspace Variable ${saved.key} saved.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Workspace Variable.");
    } finally {
      setSavingVariable(false);
    }
  };

  const removeVariable = async () => {
    if (!selectedVariable || !window.confirm(`Delete Workspace Variable ${selectedVariable.key}?`)) return;
    setDeletingVariable(true);
    try {
      await api.delete(endpoints.variable(selectedVariable.key));
      setVariables(current => current.filter(item => item.key !== selectedVariable.key));
      setSelectedVariableKey("");
      setVariableForm(emptyVariableForm());
      toast.success(`Workspace Variable ${selectedVariable.key} deleted.`);
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not delete Workspace Variable.");
    } finally {
      setDeletingVariable(false);
    }
  };

  const saveKnowledge = async () => {
    setSavingKnowledge(true);
    try {
      const response = await api.put(endpoints.knowledge(), knowledge);
      setKnowledge({
        facts: response.data?.facts ?? "",
        instructions: response.data?.instructions ?? "",
      });
      toast.success("Knowledge saved. Nora will use it on subsequent decisions.");
    } catch (error) {
      toast.error(error.response?.data?.error || "Could not save Knowledge.");
    } finally {
      setSavingKnowledge(false);
    }
  };

  if (loading) {
    return <div className="workspace-page"><div className="page-state"><span className="spinner" /> Loading Store</div></div>;
  }

  const editingCredential = creatingCredential || selectedCredential;
  const googleWorkspace = credentialForm.type === GOOGLE_WORKSPACE_TYPE;
  const editingVariable = creatingVariable || selectedVariable;
  const knowledgeCount = Number(Boolean(knowledge.facts.trim())) + Number(Boolean(knowledge.instructions.trim()));

  return (
    <div className="workspace-page store-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="eyebrow">Local runtime store</span>
          <h1>Store</h1>
          <p>Credentials, non-secret task variables, and persistent Knowledge used by Nora across conversations.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="icon-button" onClick={load} aria-label="Refresh Store">
            <IconRefresh size={18} />
          </button>
          {section !== "knowledge" && (
            <button
              type="button"
              className="button button--primary"
              onClick={section === "credentials" ? startCreateCredential : startCreateVariable}
            >
              <IconPlus size={15} /> {section === "credentials" ? "Add Credential" : "Add Variable"}
            </button>
          )}
        </div>
      </header>

      <div className="store-tabs" role="tablist" aria-label="Store sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === "credentials"}
          className={section === "credentials" ? "store-tab store-tab--active" : "store-tab"}
          onClick={() => setSection("credentials")}
        >
          <IconKey size={15} /> Credentials <span>{credentials.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "variables"}
          className={section === "variables" ? "store-tab store-tab--active" : "store-tab"}
          onClick={() => setSection("variables")}
        >
          <IconTool size={15} /> Workspace Variables <span>{variables.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "knowledge"}
          className={section === "knowledge" ? "store-tab store-tab--active" : "store-tab"}
          onClick={() => setSection("knowledge")}
        >
          <IconBrain size={15} /> Knowledge <span>{knowledgeCount}</span>
        </button>
      </div>

      {section === "credentials" ? (
        <div className="credential-layout">
          <section className="credential-list">
            {!credentials.length ? (
              <div className="empty-state empty-state--compact">
                <IconKey size={26} stroke={1.4} />
                <strong>No credentials</strong>
                <span>Add an API credential when an Agent needs authenticated access.</span>
              </div>
            ) : credentials.map(item => (
              <button
                key={item.service}
                type="button"
                className={`credential-row ${selectedService === item.service && !creatingCredential ? "credential-row--active" : ""}`}
                onClick={() => selectCredential(item.service)}
              >
                <span className="credential-row__icon"><IconKey size={16} /></span>
                <span className="credential-row__copy">
                  <strong>{item.service}</strong>
                  <span>{item.subject || item.allowedHosts?.join(", ") || "No allowed hosts"}</span>
                </span>
                <span className="status-pill">{item.type}</span>
              </button>
            ))}
          </section>

          <aside className="credential-inspector panel">
            {!editingCredential ? (
              <div className="empty-state">
                <IconKey size={28} stroke={1.4} />
                <strong>Select a Credential</strong>
                <span>Its authentication policy will appear here. Secret values are never returned.</span>
              </div>
            ) : (
              <>
                <div className="panel__header">
                  <div>
                    <span className="eyebrow">{creatingCredential ? "New credential" : "Credential"}</span>
                    <h2>{creatingCredential ? "Configure authentication" : selectedCredential.service}</h2>
                  </div>
                  <span className="status-pill status-pill--approved"><IconLock size={12} /> local only</span>
                </div>

                <div className="credential-security-note">
                  <IconLock size={16} />
                  <span>
                    {googleWorkspace
                      ? "The service-account JSON is stored in the local SQLite credential database. Nora receives only short-lived delegated authentication on approved Workspace API routes."
                      : "The secret is write-only after save. It is never returned to the UI or placed in LLM context."}
                  </span>
                </div>

                <div className="credential-form">
                  <label className="field">
                    <span>Service</span>
                    <input
                      value={credentialForm.service}
                      onChange={event => updateCredential("service", event.target.value)}
                      disabled={!creatingCredential}
                      placeholder="github"
                      autoComplete="off"
                    />
                  </label>

                  <label className="field">
                    <span>Authentication type</span>
                    <select value={credentialForm.type} onChange={event => updateCredentialType(event.target.value)}>
                      <option value="bearer">Bearer token</option>
                      <option value="api-key">API key header</option>
                      <option value="basic">Basic token</option>
                      <option value="custom">Custom header</option>
                      <option value={GOOGLE_WORKSPACE_TYPE}>Google Workspace service account</option>
                    </select>
                  </label>

                  {googleWorkspace ? (
                    <>
                      <label className="field credential-form__wide">
                        <span>Workspace user to impersonate</span>
                        <input
                          type="email"
                          value={credentialForm.subject}
                          onChange={event => updateCredential("subject", event.target.value)}
                          placeholder="you@yourdomain.com"
                          autoComplete="off"
                        />
                      </label>

                      <label className="field credential-form__wide">
                        <span>OAuth scopes · fixed to supported Workspace APIs</span>
                        <textarea
                          value={credentialForm.scopes}
                          onChange={event => updateCredential("scopes", event.target.value)}
                          rows={8}
                          spellCheck={false}
                        />
                      </label>

                      <label className="field credential-form__wide">
                        <span>Allowed Workspace API hosts · enforced by Carlos Office</span>
                        <textarea value={GOOGLE_WORKSPACE_HOSTS.join("\n")} rows={8} readOnly spellCheck={false} />
                      </label>

                      <label className="field credential-form__wide">
                        <span>{creatingCredential ? "Service-account JSON key" : "Replace service-account JSON · leave blank to keep current"}</span>
                        <textarea
                          value={credentialForm.secret}
                          onChange={event => updateCredential("secret", event.target.value)}
                          rows={10}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder={creatingCredential ? "Paste the complete Google service-account JSON key" : "Current JSON remains unchanged"}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="field credential-form__wide">
                        <span>Allowed hosts · one per line</span>
                        <textarea
                          value={credentialForm.allowedHosts}
                          onChange={event => updateCredential("allowedHosts", event.target.value)}
                          rows={5}
                          placeholder={"api.github.com\n*.githubusercontent.com"}
                          spellCheck={false}
                        />
                      </label>

                      <label className="field">
                        <span>Header</span>
                        <input value={credentialForm.headerName} onChange={event => updateCredential("headerName", event.target.value)} />
                      </label>

                      <label className="field">
                        <span>Scheme / prefix</span>
                        <input value={credentialForm.scheme} onChange={event => updateCredential("scheme", event.target.value)} placeholder="Bearer" />
                      </label>

                      <label className="field credential-form__wide">
                        <span>{creatingCredential ? "Secret" : "Replace secret · leave blank to keep current"}</span>
                        <input
                          type="password"
                          value={credentialForm.secret}
                          onChange={event => updateCredential("secret", event.target.value)}
                          autoComplete="new-password"
                          placeholder={creatingCredential ? "Enter secret" : "Current secret remains unchanged"}
                        />
                      </label>
                    </>
                  )}
                </div>

                {!creatingCredential && selectedCredential?.updatedAt && (
                  <div className="credential-updated">Updated {new Date(selectedCredential.updatedAt).toLocaleString()}</div>
                )}

                <footer className="credential-actions">
                  {!creatingCredential && (
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={removeCredential}
                      disabled={deletingCredential || savingCredential}
                    >
                      <IconTrash size={15} /> {deletingCredential ? "Deleting…" : "Delete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={saveCredential}
                    disabled={savingCredential || deletingCredential}
                  >
                    <IconKey size={15} /> {savingCredential ? "Saving…" : "Save Credential"}
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      ) : section === "variables" ? (
        <div className="credential-layout">
          <section className="credential-list">
            {!variables.length ? (
              <div className="empty-state empty-state--compact">
                <IconTool size={26} stroke={1.4} />
                <strong>No Workspace Variables</strong>
                <span>Add non-secret shared values for Nora and task Agents.</span>
              </div>
            ) : variables.map(item => (
              <button
                key={item.key}
                type="button"
                className={`credential-row ${selectedVariableKey === item.key && !creatingVariable ? "credential-row--active" : ""}`}
                onClick={() => selectVariable(item.key)}
              >
                <span className="credential-row__icon"><IconTool size={16} /></span>
                <span className="credential-row__copy">
                  <strong>{item.key}</strong>
                  <span>{item.description || item.value || "Empty value"}</span>
                </span>
                <span className="status-pill">variable</span>
              </button>
            ))}
          </section>

          <aside className="credential-inspector panel">
            {!editingVariable ? (
              <div className="empty-state">
                <IconTool size={28} stroke={1.4} />
                <strong>Select a Workspace Variable</strong>
                <span>Shared values are visible to Nora and Agents and can be used as task configuration.</span>
              </div>
            ) : (
              <>
                <div className="panel__header">
                  <div>
                    <span className="eyebrow">{creatingVariable ? "New variable" : "Workspace Variable"}</span>
                    <h2>{creatingVariable ? "Add shared task configuration" : selectedVariable.key}</h2>
                  </div>
                  <span className="status-pill"><IconTool size={12} /> non-secret</span>
                </div>

                <div className="store-variable-note">
                  <IconTool size={16} />
                  <span>
                    Workspace Variables are intentionally readable by Nora and task Agents through the workspace-variables capability. Do not store passwords, tokens, private keys, or other secrets here.
                  </span>
                </div>

                <div className="credential-form">
                  <label className="field credential-form__wide">
                    <span>Key</span>
                    <input
                      value={variableForm.key}
                      onChange={event => updateVariable("key", event.target.value)}
                      disabled={!creatingVariable}
                      placeholder="default.repository"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>

                  <label className="field credential-form__wide">
                    <span>Description</span>
                    <input
                      value={variableForm.description}
                      onChange={event => updateVariable("description", event.target.value)}
                      placeholder="What Nora should use this value for"
                      maxLength={500}
                    />
                  </label>

                  <label className="field credential-form__wide">
                    <span>Value</span>
                    <textarea
                      value={variableForm.value}
                      onChange={event => updateVariable("value", event.target.value)}
                      rows={10}
                      placeholder="Non-secret value"
                      spellCheck={false}
                    />
                  </label>
                </div>

                {!creatingVariable && selectedVariable?.updatedAt && (
                  <div className="credential-updated">Updated {new Date(selectedVariable.updatedAt).toLocaleString()}</div>
                )}

                <footer className="credential-actions">
                  {!creatingVariable && (
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={removeVariable}
                      disabled={deletingVariable || savingVariable}
                    >
                      <IconTrash size={15} /> {deletingVariable ? "Deleting…" : "Delete"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={saveVariable}
                    disabled={savingVariable || deletingVariable}
                  >
                    <IconTool size={15} /> {savingVariable ? "Saving…" : "Save Variable"}
                  </button>
                </footer>
              </>
            )}
          </aside>
        </div>
      ) : (
        <div className="credential-layout">
          <section className="credential-inspector panel">
            <div className="panel__header">
              <div>
                <span className="eyebrow">Persistent context</span>
                <h2>Knowledge</h2>
              </div>
              <span className="status-pill"><IconBrain size={12} /> private</span>
            </div>

            <div className="store-variable-note">
              <IconBrain size={16} />
              <span>
                Facts and Standing Instructions are private Markdown in the Obsidian vault. Carlos Office injects them into every Nora decision and every temporary Agent Task. Do not store passwords, tokens, or private keys here.
              </span>
            </div>

            <div className="credential-form">
              <label className="field credential-form__wide">
                <span>Facts</span>
                <textarea
                  value={knowledge.facts}
                  onChange={event => setKnowledge(current => ({ ...current, facts: event.target.value }))}
                  rows={14}
                  placeholder={"- Carlos prefers concise answers.\n- Default repository is ioweave/carlos-office.\n- ..."}
                  spellCheck={true}
                />
              </label>

              <label className="field credential-form__wide">
                <span>Standing Instructions</span>
                <textarea
                  value={knowledge.instructions}
                  onChange={event => setKnowledge(current => ({ ...current, instructions: event.target.value }))}
                  rows={14}
                  placeholder={"- Use the simplest correct implementation.\n- Ask before destructive external actions.\n- ..."}
                  spellCheck={true}
                />
              </label>
            </div>

            <footer className="credential-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={saveKnowledge}
                disabled={savingKnowledge}
              >
                <IconBrain size={15} /> {savingKnowledge ? "Saving…" : "Save Knowledge"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
