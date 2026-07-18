"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { TemplateMediaPreview } from "@/components/template-media-preview";
import { acceptsForHeaderMedia } from "@/lib/whatsapp-media";
import { extractWhatsAppTemplateVariables, getWhatsAppTemplateHeaderMediaType, type WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

export type InboxConversation = {
  id: string;
  channel: string;
  whatsapp_profile_id?: string | null;
  whatsapp_profile_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
};

export type InboxMessage = {
  id: string;
  direction: string;
  message_type: string;
  message_text: string | null;
  status: string;
  message_timestamp: string;
  contact_name: string | null;
  contact_phone: string | null;
  payload?: Record<string, unknown> | null;
};

export type InboxTemplate = {
  template_id: string;
  whatsapp_profile_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: WhatsAppTemplateComponent[];
};

type InboxSnapshot = {
  conversations: InboxConversation[];
  messages: InboxMessage[];
  selectedConversationId: string | null;
};

type ConversationFilter = "all" | "open" | "closed" | "unread";
type ComposePopupMode = "file" | "template";
type TemplateMappingRule = {
  mode: "field" | "constant";
  value: string;
};

type InboxMedia = {
  type: string;
  id: string;
  caption: string;
  filename: string;
  mimeType: string;
};

const replyWindowMs = 24 * 60 * 60 * 1000;

function displayDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function senderNameFromMessage(text: string | null | undefined) {
  const message = text?.trim();
  if (!message) return "";
  const patterns = [
    /^Full\s*name\s*:\s*(.+)$/im,
    /^Name\s*:\s*(.+)$/im
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const name = match?.[1]?.trim();
    if (name) return name;
  }
  return "";
}

function isNumericIdentifier(value: string | null | undefined) {
  return Boolean(value && /^\d{8,}$/.test(value.trim()));
}

function conversationTitle(conversation: InboxConversation) {
  const parsedName = senderNameFromMessage(conversation.last_message_preview);
  if (conversation.channel === "facebook" && parsedName && isNumericIdentifier(conversation.contact_name)) return parsedName;
  return conversation.contact_name || conversation.contact_phone || "Unknown contact";
}

function channelSlug(channel: string | null | undefined) {
  const normalized = String(channel ?? "").toLowerCase();
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("facebook")) return "facebook";
  return "whatsapp";
}

function ChannelIcon({ channel }: { channel: string | null | undefined }) {
  const slug = channelSlug(channel);
  if (slug === "instagram") {
    return (
      <span aria-label="Instagram" className="channel-icon channel-instagram" title="Instagram">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <rect height="16" rx="5" width="16" x="4" y="4" />
          <circle cx="12" cy="12" r="3.5" />
          <circle cx="16.8" cy="7.2" r="1" />
        </svg>
      </span>
    );
  }
  if (slug === "facebook") {
    return (
      <span aria-label="Facebook" className="channel-icon channel-facebook" title="Facebook">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M14 8.2h2.4V4.4c-.4-.1-1.8-.2-3.4-.2-3.4 0-5.7 2.1-5.7 6v3.4H3.6v4.3h3.7V24h4.5v-6.1h3.5l.6-4.3h-4.1v-3c0-1.2.3-2.4 2.2-2.4Z" />
        </svg>
      </span>
    );
  }
  return (
    <span aria-label="WhatsApp" className="channel-icon channel-whatsapp" title="WhatsApp">
      <img alt="" src="/whatsapp-logo.png" />
    </span>
  );
}

function channelDisplayName(channel: string | null | undefined) {
  const slug = channelSlug(channel);
  if (slug === "facebook") return "Facebook";
  if (slug === "instagram") return "Instagram";
  return "WhatsApp";
}

function replyWindowChannelName(channel: string | null | undefined) {
  const slug = channelSlug(channel);
  if (slug === "facebook") return "Facebook";
  if (slug === "instagram") return "Instagram";
  return "WhatsApp";
}

function outgoingStatusMark(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "read") return { mark: "✓✓", label: "Seen", className: "seen" };
  if (normalized === "delivered") return { mark: "✓✓", label: "Delivered", className: "delivered" };
  if (normalized === "failed") return { mark: "!", label: "Failed", className: "failed" };
  return { mark: "✓", label: "Sent", className: "sent" };
}

function mediaFromMessage(message: InboxMessage): InboxMedia | null {
  const payload = message.payload ?? {};
  const media = payload[message.message_type];
  if (!media || typeof media !== "object") return null;
  const record = media as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  if (!id) return null;
  return {
    type: message.message_type,
    id,
    caption: String(record.caption ?? "").trim(),
    filename: String(record.filename ?? "").trim(),
    mimeType: String(record.mime_type ?? "").trim()
  };
}

function mediaLabel(media: InboxMedia) {
  if (media.filename) return media.filename;
  if (media.type === "image") return "Image";
  if (media.type === "video") return "Video";
  if (media.type === "audio") return "Audio";
  if (media.type === "document") return "Document";
  return "Attachment";
}

function replaceTemplateVariables(text: string | undefined, component: "header" | "body", mappings: Record<string, TemplateMappingRule>) {
  return (text || "").replace(/\{\{(\d+)\}\}/g, (_, position: string) => {
    const rule = mappings[`${component}.${position}`];
    if (!rule?.value) return `[${component} ${position}]`;
    return rule.mode === "constant" ? rule.value : `{${rule.value}}`;
  });
}

function buildTemplatePreview(template: InboxTemplate | null, mappings: Record<string, TemplateMappingRule>) {
  if (!template) return { header: "", body: "Select a template to preview the message.", buttons: [] as string[] };
  let header = "";
  let body = "";
  const buttons: string[] = [];
  template.components.forEach((component) => {
    const type = component.type?.toUpperCase();
    if (type === "HEADER") header = replaceTemplateVariables(component.text, "header", mappings);
    if (type === "BODY") body = replaceTemplateVariables(component.text, "body", mappings);
    if (type === "BUTTONS") {
      (component.buttons ?? []).forEach((button, index) => {
        const buttonText = button.text || "Button";
        const url = (button.url || "").replace(/\{\{(\d+)\}\}/g, (_, position: string) => {
          const rule = mappings[`button.${index}.${position}`];
          if (!rule?.value) return `[button ${position}]`;
          return rule.mode === "constant" ? rule.value : `{${rule.value}}`;
        });
        buttons.push(url ? `${buttonText}: ${url}` : buttonText);
      });
    }
  });
  return { header, body: body || "This template has no body text.", buttons };
}

function latestIncomingAt(messages: InboxMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "incoming") return message.message_timestamp;
  }
  return null;
}

function replyWindowStatus(messages: InboxMessage[], nowMs: number) {
  const latestIncoming = latestIncomingAt(messages);
  if (!latestIncoming) return { isOpen: false, label: "No incoming message" };
  const remainingMs = new Date(latestIncoming).getTime() + replyWindowMs - nowMs;
  if (remainingMs <= 0) return { isOpen: false, label: "Outside 24 hrs" };
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.max(1, Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000)));
  return { isOpen: true, label: `${hours}h ${minutes}m left` };
}

export function InboxPanel({
  canReply,
  initialConversations,
  initialMessages,
  initialSelectedConversationId,
  templates
}: {
  canReply: boolean;
  initialConversations: InboxConversation[];
  initialMessages: InboxMessage[];
  initialSelectedConversationId: string | null;
  templates: InboxTemplate[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [messages, setMessages] = useState(initialMessages);
  const [selectedConversationId, setSelectedConversationId] = useState(initialSelectedConversationId);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConversationFilter>("open");
  const [search, setSearch] = useState("");
  const [pinnedConversationId, setPinnedConversationId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [composePopupOpen, setComposePopupOpen] = useState(false);
  const [composePopupMode, setComposePopupMode] = useState<ComposePopupMode>("file");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateMappings, setTemplateMappings] = useState<Record<string, TemplateMappingRule>>({});
  const [templateHeaderFile, setTemplateHeaderFile] = useState<File | null>(null);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId]
  );

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visible = conversations.filter((conversation) => {
      const searchMatched = !query || [
        conversation.contact_name,
        conversation.contact_phone,
        conversation.whatsapp_profile_name,
        conversation.last_message_preview
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
      if (!searchMatched) return false;
      if (query) return true;
      if (filter === "all") return true;
      if (filter === "unread") return conversation.unread_count > 0;
      return conversation.status.toLowerCase() === filter;
    });

    if (selectedConversation?.id === pinnedConversationId && !visible.some((conversation) => conversation.id === selectedConversation.id)) {
      return [selectedConversation, ...visible];
    }
    return visible;
  }, [conversations, filter, pinnedConversationId, search, selectedConversation]);

  const selectedIsWhatsApp = channelSlug(selectedConversation?.channel) === "whatsapp";
  const replyWindow = useMemo(() => replyWindowStatus(messages, nowMs), [messages, nowMs]);
  const canSendReply = canReply && (!selectedIsWhatsApp || replyWindow.isOpen);
  const availableTemplates = useMemo(() => {
    if (!selectedConversation?.whatsapp_profile_id) return [];
    return templates.filter((template) => template.status === "APPROVED" && template.whatsapp_profile_id === selectedConversation.whatsapp_profile_id);
  }, [selectedConversation?.whatsapp_profile_id, templates]);
  const templateOptions = availableTemplates.map((template) => ({
    value: template.template_id,
    label: `${template.name} (${template.language})`,
    helper: template.category ?? "Approved template"
  }));
  const selectedTemplate = availableTemplates.find((template) => template.template_id === selectedTemplateId) ?? null;
  const templateVariables = useMemo(() => extractWhatsAppTemplateVariables(selectedTemplate?.components ?? []), [selectedTemplate]);
  const templateHeaderMediaType = useMemo(() => getWhatsAppTemplateHeaderMediaType(selectedTemplate?.components ?? []), [selectedTemplate]);
  const templatePreview = useMemo(() => buildTemplatePreview(selectedTemplate, templateMappings), [selectedTemplate, templateMappings]);
  const selectedChannelName = channelDisplayName(selectedConversation?.channel);
  const selectedReplyWindowName = replyWindowChannelName(selectedConversation?.channel);
  const profileFieldOptions = useMemo(() => ([
    { value: "contact_name", label: "Contact name" },
    { value: "contact_phone", label: "Contact phone" },
    { value: "profile_name", label: "WhatsApp profile name" },
    { value: "phone_number_id", label: "Profile phone number ID" },
    { value: "channel", label: "Channel" }
  ]), []);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight });
  }, [messages.length, selectedConversationId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const query = search.trim();
        const response = await fetch(`/api/inbox${query ? `?search=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
        const payload = await response.json() as InboxSnapshot & { error?: string };
        if (stopped) return;
        if (!response.ok || payload.error) throw new Error(payload.error || "Unable to search inbox.");
        setConversations(payload.conversations);
        setError(null);
      } catch (searchError) {
        if (!stopped) setError(searchError instanceof Error ? searchError.message : "Unable to search inbox.");
      }
    }, 300);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  useEffect(() => {
    if (!selectedConversationId) return undefined;
    const activeConversationId = selectedConversationId;
    let stopped = false;

    async function refresh() {
      if (stopped) return;
      try {
        const response = await fetch(`/api/inbox?conversation=${encodeURIComponent(activeConversationId)}`, { cache: "no-store" });
        const payload = await response.json() as InboxSnapshot & { error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error || "Unable to refresh inbox.");
        setConversations(payload.conversations);
        setMessages(payload.messages);
        setError(null);
      } catch {
        // Keep the existing thread visible if a background refresh fails.
      }
    }

    const timer = window.setInterval(refresh, 5_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [selectedConversationId]);

  function applySnapshot(snapshot: InboxSnapshot, nextSelectedConversationId = snapshot.selectedConversationId) {
    setConversations(snapshot.conversations);
    setMessages(snapshot.messages);
    setSelectedConversationId(nextSelectedConversationId);
  }

  async function selectConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setPinnedConversationId(conversationId);
    setError(null);
    window.history.replaceState(null, "", `/inbox?conversation=${encodeURIComponent(conversationId)}`);
    try {
      const response = await fetch(`/api/inbox?conversation=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      const payload = await response.json() as InboxSnapshot & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to load conversation.");
      applySnapshot(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load conversation.");
    }
  }

  async function sendReply() {
    if (!selectedConversation || !replyText.trim() || sending || !canSendReply) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConversation.id, text: replyText.trim() })
      });
      const payload = await response.json() as { snapshot?: InboxSnapshot; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to send reply.");
      if (payload.snapshot) applySnapshot(payload.snapshot);
      setFilter("open");
      setReplyText("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send reply.");
    } finally {
      setSending(false);
    }
  }

  async function refreshSelectedConversation(conversationId: string) {
    const response = await fetch(`/api/inbox?conversation=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
    const payload = await response.json() as InboxSnapshot & { error?: string };
    if (!response.ok || payload.error) throw new Error(payload.error || "Unable to refresh inbox.");
    applySnapshot(payload);
  }

  async function sendAttachment() {
    if (!selectedConversation || !attachmentFile || sendingAttachment || !canSendReply) return;
    setSendingAttachment(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("conversationId", selectedConversation.id);
      formData.set("caption", attachmentCaption.trim());
      formData.set("file", attachmentFile);
      const response = await fetch("/api/inbox/attachment", { method: "POST", body: formData });
      const payload = await response.json() as { snapshot?: InboxSnapshot; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to send attachment.");
      if (payload.snapshot) applySnapshot(payload.snapshot);
      else await refreshSelectedConversation(selectedConversation.id);
      setAttachmentFile(null);
      setAttachmentCaption("");
      setComposePopupOpen(false);
      setFilter("open");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send attachment.");
    } finally {
      setSendingAttachment(false);
    }
  }

  async function sendTemplate() {
    if (!selectedConversation || !selectedTemplateId || sendingTemplate) return;
    setSendingTemplate(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("conversationId", selectedConversation.id);
      formData.set("templateId", selectedTemplateId);
      formData.set("mappings", JSON.stringify(templateMappings));
      if (templateHeaderFile) formData.set("headerMediaFile", templateHeaderFile);
      const response = await fetch("/api/inbox/template", { method: "POST", body: formData });
      const payload = await response.json() as { snapshot?: InboxSnapshot; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to send template.");
      if (payload.snapshot) applySnapshot(payload.snapshot);
      else await refreshSelectedConversation(selectedConversation.id);
      setSelectedTemplateId("");
      setTemplateMappings({});
      setTemplateHeaderFile(null);
      setComposePopupOpen(false);
      setFilter("open");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send template.");
    } finally {
      setSendingTemplate(false);
    }
  }

  function updateTemplateMapping(key: string, patch: Partial<TemplateMappingRule>) {
    setTemplateMappings((current) => {
      const previous = current[key] ?? { mode: "field", value: "" };
      return { ...current, [key]: { ...previous, ...patch } };
    });
  }

  async function closeChat() {
    if (!selectedConversation || closing) return;
    setClosing(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConversation.id, status: "closed" })
      });
      const payload = await response.json() as { snapshot?: InboxSnapshot; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "Unable to close chat.");
      setFilter("open");
      if (payload.snapshot) applySnapshot(payload.snapshot, null);
      else {
        setSelectedConversationId(null);
        setMessages([]);
      }
      window.history.replaceState(null, "", "/inbox");
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "Unable to close chat.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <section className="panel inbox-panel">
      <div className="inbox-layout">
        <aside className="inbox-conversations">
          <div className="inbox-section-head">
            <div>
              <h2>Conversations</h2>
              <p className="subtle">{filteredConversations.length} thread{filteredConversations.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="inbox-filter-row">
            {([
              ["all", "All"],
              ["open", "Open"],
              ["closed", "Closed"],
              ["unread", "Unread"]
            ] as Array<[ConversationFilter, string]>).map(([value, label]) => (
              <button
                className={`inbox-filter-button ${filter === value ? "active" : ""}`}
                key={value}
                onClick={() => {
                  setPinnedConversationId(null);
                  setFilter(value);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inbox-search-row">
            <input
              className="field"
              onChange={(event) => {
                setSearch(event.target.value);
                setFilter("all");
                setPinnedConversationId(null);
              }}
              placeholder="Search name, mobile, message"
              type="search"
              value={search}
            />
          </div>
          <div className="inbox-conversation-list">
            {filteredConversations.length ? filteredConversations.map((conversation) => {
              const selected = selectedConversation?.id === conversation.id;
              return (
                <button
                  className={`inbox-conversation-item ${selected ? "active" : ""}`}
                  disabled={selected}
                  key={conversation.id}
                  onClick={() => selectConversation(conversation.id)}
                  type="button"
                >
                  <div className="inbox-avatar">{conversationTitle(conversation).slice(0, 1).toUpperCase()}</div>
                  <div className="inbox-conversation-copy">
                    <strong>{conversationTitle(conversation)}</strong>
                    <span>{conversation.last_message_preview || "No message text"}</span>
                    <small>{conversation.whatsapp_profile_name || channelDisplayName(conversation.channel)} - {displayDate(conversation.last_message_at)}</small>
                  </div>
                  <div className="inbox-conversation-side">
                    <ChannelIcon channel={conversation.channel} />
                    {conversation.unread_count > 0 ? <span className="inbox-unread">{conversation.unread_count}</span> : null}
                  </div>
                </button>
              );
            }) : <div className="empty-cell">No conversations found.</div>}
          </div>
        </aside>

        <div className="inbox-thread">
          {selectedConversation ? (
            <>
              <div className="inbox-thread-head">
                <div>
                  <h2>{conversationTitle(selectedConversation)}</h2>
                  <p className="subtle inbox-thread-meta">
                    <ChannelIcon channel={selectedConversation.channel} />
                    <span>{selectedConversation.contact_phone || "-"}</span>
                    <span>-</span>
                    <span>{selectedConversation.whatsapp_profile_name || selectedChannelName}</span>
                  </p>
                </div>
                <div className="inbox-thread-actions">
                  {selectedIsWhatsApp ? <span className={`reply-window-pill ${replyWindow.isOpen ? "open" : "closed"}`}>{replyWindow.label}</span> : null}
                  <span className={`status-pill ${selectedConversation.status === "closed" ? "warn" : "good"}`}>{selectedConversation.status}</span>
                  {selectedConversation.status !== "closed" ? (
                    <button className="button secondary compact" disabled={closing} onClick={closeChat} type="button">
                      {closing ? "Closing" : "Close Chat"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="inbox-message-list" ref={messageListRef}>
                {messages.map((message) => {
                  const statusMark = outgoingStatusMark(message.status);
                  const senderName = outgoingSenderName(message);
                  const media = mediaFromMessage(message);
                  const mediaUrl = media ? `/api/inbox/media?message=${encodeURIComponent(message.id)}` : "";
                  const bodyText = media?.caption || message.message_text;
                  return (
                    <div className={`inbox-message ${message.direction === "incoming" ? "incoming" : "outgoing"}`} key={message.id}>
                      <div className="inbox-message-bubble">
                        {message.direction === "outgoing" && senderName ? <strong className="inbox-message-sender">{senderName}</strong> : null}
                        {media ? (
                          <div className={`inbox-media inbox-media-${media.type}`}>
                            {media.type === "image" || media.type === "sticker" ? (
                              <a href={mediaUrl} target="_blank" rel="noreferrer">
                                <img alt={mediaLabel(media)} src={mediaUrl} />
                              </a>
                            ) : (
                              <a className="inbox-file-link" href={mediaUrl} target="_blank" rel="noreferrer">
                                <span className="inbox-file-icon">{media.type === "document" ? "DOC" : media.type.toUpperCase()}</span>
                                <span>
                                  <strong>{mediaLabel(media)}</strong>
                                  {media.mimeType ? <small>{media.mimeType}</small> : null}
                                </span>
                              </a>
                            )}
                          </div>
                        ) : null}
                        {bodyText ? <p>{bodyText}</p> : !media ? <p>{`[${message.message_type}]`}</p> : null}
                        <span>
                          {displayDate(message.message_timestamp)}
                          {message.direction === "outgoing" ? (
                            <b className={`inbox-tick ${statusMark.className}`} title={statusMark.label}>{statusMark.mark}</b>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="inbox-compose">
                {error ? <p className="inline-error"><strong>Reply not sent</strong><span>{error}</span></p> : null}
                {selectedIsWhatsApp && !replyWindow.isOpen ? <p className="inline-error"><strong>Outside 24 hrs</strong><span>Free text reply is unavailable after the {selectedReplyWindowName} reply window closes.</span></p> : null}
                {selectedConversation.status === "closed" && canSendReply ? <p className="inbox-compose-note">This chat is closed. Sending a reply will reopen it.</p> : null}
                <button
                  aria-label="Add attachment or template"
                  className="inbox-compose-plus"
                  disabled={!canReply}
                  onClick={() => setComposePopupOpen(true)}
                  type="button"
                >
                  +
                </button>
                <textarea
                  className="field"
                  disabled={!canSendReply || sending}
                  onChange={(event) => setReplyText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder={canReply ? `Type a ${selectedChannelName} reply` : "No reply permission"}
                  rows={2}
                  value={replyText}
                />
                <button
                  className="button"
                  disabled={!canSendReply || !replyText.trim() || sending}
                  onClick={sendReply}
                  type="button"
                >
                  {sending ? "Sending" : "Send"}
                </button>
              </div>
              {composePopupOpen ? (
                <div className="modal-backdrop" onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setComposePopupOpen(false);
                }}>
                  <section aria-label="Add file or template" className="modal-panel wide inbox-compose-modal">
                    <div className="modal-header">
                      <div>
                        <h2>Add to chat</h2>
                        <p className="subtle">{selectedIsWhatsApp ? "Send an attachment inside 24 hours, or send an approved WhatsApp template." : `Send an attachment to this ${selectedChannelName} chat.`}</p>
                      </div>
                      <button className="icon-button" onClick={() => setComposePopupOpen(false)} type="button">x</button>
                    </div>
                    <div className="inbox-compose-tabs">
                      <button className={composePopupMode === "file" ? "active" : ""} onClick={() => setComposePopupMode("file")} type="button">File</button>
                      <button className={composePopupMode === "template" ? "active" : ""} onClick={() => setComposePopupMode("template")} type="button">Template</button>
                    </div>
                    {composePopupMode === "file" ? (
                      <div className="inbox-compose-popup-grid">
                        <div className="inbox-compose-popup-form">
                          {selectedIsWhatsApp && !replyWindow.isOpen ? <p className="inline-error"><strong>Outside 24 hrs</strong><span>Files can be sent only during the WhatsApp reply window.</span></p> : null}
                          <label>File
                            <input
                              className="field"
                              disabled={!canSendReply || sendingAttachment}
                              onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
                              type="file"
                            />
                          </label>
                          <label>Caption
                            <textarea
                              className="field"
                              disabled={!canSendReply || sendingAttachment}
                              onChange={(event) => setAttachmentCaption(event.target.value)}
                              placeholder="Optional caption"
                              rows={3}
                              value={attachmentCaption}
                            />
                          </label>
                        </div>
                        <aside className="bulk-template-preview">
                          <h3>File send</h3>
                          <p>{attachmentFile ? attachmentFile.name : "Select a file to send to this contact."}</p>
                          {selectedIsWhatsApp ? <small>{replyWindow.label}</small> : null}
                        </aside>
                        <div className="form-actions modal-actions">
                          <button className="button secondary" onClick={() => setComposePopupOpen(false)} type="button">Cancel</button>
                          <button className="button" disabled={!canSendReply || !attachmentFile || sendingAttachment} onClick={sendAttachment} type="button">
                            {sendingAttachment ? "Sending" : "Send file"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="inbox-compose-popup-grid">
                        <div className="inbox-compose-popup-form">
                          <label>WhatsApp template
                            <SearchableSelect
                              name="inbox_template_id"
                              onValueChange={(value) => {
                                setSelectedTemplateId(value);
                                setTemplateMappings({});
                                setTemplateHeaderFile(null);
                              }}
                              options={templateOptions}
                              placeholder={availableTemplates.length ? "Search approved template" : "No approved templates for this profile"}
                              value={selectedTemplateId}
                            />
                          </label>
                          {templateHeaderMediaType ? (
                            <label>{`Header ${templateHeaderMediaType}`}
                              <input
                                accept={acceptsForHeaderMedia(templateHeaderMediaType)}
                                className="field"
                                onChange={(event) => setTemplateHeaderFile(event.target.files?.[0] ?? null)}
                                required
                                type="file"
                              />
                              <span className="subtle">Required by this template header.</span>
                            </label>
                          ) : null}
                          {templateVariables.length ? templateVariables.map((variable) => {
                            const rule = templateMappings[variable.key] ?? { mode: "field", value: "" };
                            return (
                              <div className="inbox-template-variable-row" key={variable.key}>
                                <div>
                                  <strong>{variable.label}</strong>
                                  <span>{variable.component}</span>
                                </div>
                                <select
                                  className="field"
                                  onChange={(event) => updateTemplateMapping(variable.key, { mode: event.target.value as "field" | "constant", value: "" })}
                                  value={rule.mode}
                                >
                                  <option value="field">Profile field</option>
                                  <option value="constant">Constant</option>
                                </select>
                                {rule.mode === "field" ? (
                                  <SearchableSelect
                                    name={`template_mapping_${variable.key}`}
                                    onValueChange={(value) => updateTemplateMapping(variable.key, { value })}
                                    options={profileFieldOptions}
                                    placeholder="Select profile field"
                                    value={rule.value}
                                  />
                                ) : (
                                  <input
                                    className="field"
                                    onChange={(event) => updateTemplateMapping(variable.key, { value: event.target.value })}
                                    placeholder="Enter constant value"
                                    value={rule.value}
                                  />
                                )}
                              </div>
                            );
                          }) : selectedTemplate ? <p className="subtle">This template has no variables.</p> : null}
                        </div>
                        <aside className="bulk-template-preview">
                          <h3>Preview</h3>
                          <TemplateMediaPreview file={templateHeaderFile} type={templateHeaderMediaType} />
                          {templatePreview.header ? <strong>{templatePreview.header}</strong> : null}
                          <p>{templatePreview.body}</p>
                          {templatePreview.buttons.length ? (
                            <div className="preview-buttons">
                              {templatePreview.buttons.map((button, index) => <span key={`${button}-${index}`}>{button}</span>)}
                            </div>
                          ) : null}
                        </aside>
                        <div className="form-actions modal-actions">
                          <button className="button secondary" onClick={() => setComposePopupOpen(false)} type="button">Cancel</button>
                          <button className="button" disabled={!selectedTemplateId || Boolean(templateHeaderMediaType && !templateHeaderFile) || sendingTemplate} onClick={sendTemplate} type="button">
                            {sendingTemplate ? "Sending" : "Send template"}
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-cell">Select a conversation to view messages.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function outgoingSenderName(message: InboxMessage) {
  if (message.direction !== "outgoing") return "";
  const payload = message.payload ?? {};
  const value = payload.sender_name ?? payload.sent_by_name ?? payload.created_by_name ?? payload.sender_email ?? "";
  return String(value || "").trim();
}
