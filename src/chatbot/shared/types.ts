// src/app/[locale]/chatbot/lib/regulart-chat.types.ts (Frontend path) ==== src/shared/types.ts (Backend path)
// Đây là file types dùng chung cho cả frontend và backend của regular chat.


import { Socket } from "socket.io"; // Socket.IO types for handler context
import { FunctionCall, Part as GoogleGenAiPart } from "@google/genai";

// --- Basic Utility Types ---

/**
 * Represents the set of supported natural languages in the application.
 * @description Used for localization, API requests, and user preferences.
 */
export type Language = 'en' | 'vi' | 'zh' | 'de' | 'fr' | 'es' | 'ru' | 'ja' | 'ko' | 'ar'; // Extend as needed

/**
 * Represents the available prebuilt voices for text-to-speech functionality.
 * @description Used in TTS configuration.
 */
export type PrebuiltVoice = "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede" | "Orus" | "Zephyr";

/**
 * Defines the possible output modalities for AI responses.
 * @description Specifies the format of the AI's output (e.g., text, audio).
 */
export type OutputModality = "text" | "audio" | "image";

/**
 * Defines the chat interaction mode.
 * @description Indicates if responses should be streamed live ('live') or sent as a single block ('regular').
 */
export type ChatMode = 'live' | 'regular';

/**
 * Defines the structure for a language option presented to the user in the UI.
 * @description Used for language selection components.
 */
export interface LanguageOption {
    /** The language code (e.g., 'en' for English). */
    code: Language;
    /** The human-readable name of the language (e.g., 'English'). */
    name: string;
    /** The flag code for displaying country flag icons (e.g., 'gb' for Great Britain, 'vn' for Vietnam). */
    flagCode: string;
}

// --- Core Chat & Message Types ---

/**
 * Represents a single part of a message, aligned with Google's Generative AI SDK.
 * @description This can be text, inline data (e.g., image bytes), a file URI, a function call, or a function response.
 * @see https://ai.google.dev/api/rest/v1beta/Content#part
 */
export type Part = GoogleGenAiPart;

/**
 * Stores original information about a user-uploaded file.
 * @description Sent from frontend to backend for persistence and reference, especially when `Part` contains a `fileData` URI.
 */
export interface OriginalUserFileInfo {
  /** Original file name. */
  name: string;
  /** Original file size in bytes. */
  size: number;
  /** Original MIME type. */
  type: string;
  /** The URI returned by Google File API (or other storage) after upload. Backend uses this to retrieve the file. */
  googleFileUri: string;
}

/**
 * Defines the structure for a single item in the conversation history.
 * @description This is the canonical representation of a message stored in the backend and exchanged between backend and frontend.
 * It's directly compatible with Google AI SDK's content structure.
 */
export interface ChatHistoryItem {
    /** A unique identifier for the message (e.g., UUID). Frontend generates for user messages, backend for model messages. */
    uuid: string;
    /** The role of the entity that produced this part of the conversation (e.g., 'user', 'model', 'function'). */
    role: "user" | "model" | "function";
    /** The content parts, directly using the Google AI SDK's Part type. */
    parts: Part[];
    /** Optional ISO timestamp indicating when the history item was created/added. */
    timestamp?: string | Date;
    /** Optional: Model's thought process steps that led to this message (if role is 'model'). */
    thoughts?: ThoughtStep[];
    /** Optional: Action requested by the model for the frontend to perform. */
    action?: FrontendAction;
    /**
     * Optional: Information about original user files associated with this message.
     * Primarily relevant for 'user' role messages containing file uploads.
     * This provides metadata beyond what might be in `parts[].fileData`.
     */
    userFileInfo?: OriginalUserFileInfo[];
}

/**
 * Defines the possible display types for a message rendered in the chat UI.
 * @description Helps the frontend decide how to render a message.
 */
export type ChatMessageDisplayType =
    | 'text'          // Standard text message
    | 'multimodal'    // Message with mixed content (text, images, files)
    | 'error'         // Error message display
    | 'warning'       // Warning message display
    | 'map'           // Display a map based on a location
    | 'follow_update' // Notification about a follow status change
    | 'blacklist_update'// Notification about a blacklist status change
    | 'calendar_update' // Notification about a calendar status change
    | undefined;      // Default or unspecified

/**
 * Represents a file uploaded by the user, primarily for UI display and initial handling on the frontend.
 * @description Contains data URL for client-side preview before actual upload.
 */
export interface UserDisplayFile {
  /** File name. */
  name: string;
  /** MIME type. */
  type: string;
  /** File size in bytes. */
  size: number;
  /** Optional: Data URL (blob or base64) for client-side preview. */
  dataUrl?: string;
}

/**
 * Represents a file sent by the bot, for UI display on the frontend.
 * @description Can be a URI to an external file or inline data.
 */
export interface BotDisplayFile {
  /** URI if it's a file from Google File API or external link. */
  uri?: string;
  /** Base64 data for inline content (e.g., small images). */
  inlineData?: { mimeType: string; data: string };
  /** MIME type of the file. Always present. */
  mimeType: string;
  /** Optional: A display name for the bot's file. */
  name?: string;
}

/**
 * Structure for a message adapted for display in the chat UI (Frontend).
 * @description This is derived from `ChatHistoryItem` by the frontend, adding UI-specific properties.
 */
export interface ChatMessageView {
  /** Unique identifier, typically the `uuid` from `ChatHistoryItem`. */
  id: string;
  /** The role of the message sender ('user', 'model', 'function'). */
  role: "user" | "model" | "function";
  /** The original `Part[]` from `ChatHistoryItem`, used by renderers to display rich content. */
  parts: Part[];
  /**
   * Optional: A primary textual representation of the message.
   * This can be extracted from `parts` or be a summary.
   * For non-text messages (e.g., only an image), this might be a placeholder or undefined.
   */
  text?: string;
  /** True if the message is from the user, false otherwise. Derived from `role`. */
  isUser: boolean;
  /** The display type dictating how the UI should render this message. */
  type: ChatMessageDisplayType;
  /** Timestamp of the message. */
  timestamp?: string | Date;
  /** Optional: Model's thought process associated with this message. */
  thoughts?: ThoughtStep[];
  /** Optional: Frontend action associated with this message. */
  action?: FrontendAction;
  /** Optional: Location string, used if `type` is 'map'. */
  location?: string;
  /** Optional: Error or warning code, used if `type` is 'error' or 'warning'. */
  errorCode?: string;
  /**
   * Optional: Files uploaded by the user, adapted for display.
   * Mapped by frontend from `ChatHistoryItem.userFileInfo` or `ChatHistoryItem.parts` for user messages.
   */
  userDisplayFiles?: UserDisplayFile[];
  /**
   * Optional: Files sent by the bot, adapted for display.
   * Mapped by frontend from `ChatHistoryItem.parts` for model messages.
   */
  botDisplayFiles?: BotDisplayFile[];
}


// --- Item Types (Conferences, Journals, etc.) ---

/**
 * Defines the date range for an item, typically for conferences or journals.
 */
export interface ItemDateRange {
    /** The start date of the item, in ISO Date string format (YYYY-MM-DD). */
    fromDate: string;
    /** The end date of the item, in ISO Date string format (YYYY-MM-DD). */
    toDate: string;
}

/**
 * Defines the location details for an item.
 */
export interface ItemLocation {
    /** The specific address of the location. */
    address?: string;
    /** The city, state, or province. */
    cityStateProvince?: string;
    /** The country. */
    country?: string;
    /** The continent. */
    continent?: string;
}

/**
 * Represents a generic item (e.g., conference, journal) that can be followed by a user.
 */
export interface FollowableItem {
    /** The unique identifier of the item. */
    id: string;
    /** The title or name of the item. */
    title: string;
    /** The acronym or abbreviation of the item. */
    acronym: string;
    /** Optional ISO timestamp when the item was created in the system. */
    createdAt?: string;
    /** Optional ISO timestamp when the item was last updated in the system. */
    updatedAt?: string;
    /** Optional ISO timestamp when the user followed this item. */
    followedAt?: string;
    /** Optional status of the item (e.g., "ACTIVE", "PAST"). */
    status?: string;
    /** Optional date range associated with the item. */
    dates?: ItemDateRange;
    /** Optional location details for the item. */
    location?: ItemLocation;
    /** The type of the item. */
    itemType: "conference" | "journal";
    // Additional fields can be added here as needed for specific item types.
    // E.g., `websiteUrl?: string;` for conferences, `publisher?: string;` for journals.
}

/**
 * Represents a generic item (e.g., conference) that can be blacklisted by a user.
 * @description Backend API for blacklist might use `conferenceId`.
 */
export interface BlacklistItem {
    /** The unique identifier of the item (e.g., conference ID) in the blacklist context. Matches backend API. */
    conferenceId: string;
    /** The title or name of the item. */
    title: string;
    /** The acronym or abbreviation of the item. */
    acronym: string;
    /** Optional ISO timestamp when the item was created. */
    createdAt?: string;
    /** Optional ISO timestamp when the item was last updated. */
    updatedAt?: string;
    /** Optional status of the item. */
    status?: string;
    /** Optional date range associated with the item. */
    dates?: ItemDateRange;
    /** Optional location details for the item. */
    location?: ItemLocation;
    // itemType is implicitly 'conference' for BlacklistItem based on current usage.
}

/**
 * Represents an item (e.g., conference) that can be added to a user's calendar.
 * @description Properties align with backend API expectations for calendar items.
 */
export interface CalendarItem {
    /** The unique identifier of the conference event. Backend API uses 'id'. */
    id: string;
    /** The title or name of the conference. Backend API uses 'title'. */
    title: string;
    /** Optional acronym or abbreviation. */
    acronym?: string;
    /** The unique identifier of the creator. */
    creatorId: string | null;
    /** The unique identifier of the administrator. */
    adminId: string;
    /** ISO timestamp when the item was followed by the user (if applicable to calendar context). */
    followedAt: string; // Or perhaps 'addedToCalendarAt'? Clarify semantics if needed.
    /** ISO timestamp when the item was last updated. */
    updatedAt: string;
    /** The status of the item (e.g., "CRAWLED", "CONFIRMED"). */
    status: string;
    /** Date range associated with the item. */
    dates: ItemDateRange;
    /** Location details for the item. Note: Stricter than generic ItemLocation. */
    location: {
        address: string;
        cityStateProvince: string;
        country: string;
        continent: string;
    };
}

// --- Personalization ---

/**
 * Payload containing user personalization data.
 * @description Sent from frontend to backend with messages to tailor AI responses.
 */
export interface PersonalizationPayload {
    firstName?: string;
    lastName?: string;
    aboutMe?: string;
    interestedTopics?: string[];
}

// --- API & Service Result Types (Generic) ---

/**
 * Represents the generic result structure for an internal API call or service operation within the backend.
 */
export interface ApiCallResult {
    /** Indicates whether the API call was successful in retrieving and processing data. */
    success: boolean;
    /** The raw string data received from the API (could be JSON, plain text, or an error message). Null if no response was obtained. */
    rawData: string | null;
    /** Optional formatted string data after successful transformation (null if not applicable or transformation failed). */
    formattedData: string | null;
    /** Optional error message describing issues during the API call, data parsing, or transformation. */
    errorMessage?: string;
}

// --- Gemini Model Interaction Types ---

/**
 * Defines the possible outcomes of a single interaction turn with the Gemini model (backend internal).
 */
export interface GeminiInteractionResult {
    /** The status indicating the outcome of the generation attempt. */
    status: "requires_function_call" | "final_text" | "error";
    /** The function call requested by the model (present if status is 'requires_function_call'). */
    functionCall?: FunctionCall;
    /** The final text response generated by the model (present if status is 'final_text'). */
    text?: string;
    /** Optional: The full structured parts from the model's response, especially if it's multimodal. */
    parts?: Part[];
    /** An error message if the generation failed (present if status is 'error'). */
    errorMessage?: string;
}

// --- Thought Process & Agent Types ---

/**
 * Defines possible identifiers for different AI agents or modules within the system.
 * @description Used in `ThoughtStep` and `StatusUpdate` to identify the source.
 */
export type AgentId = 'HostAgent' | 'ConferenceAgent' | 'JournalAgent' | 'AdminContactAgent' | 'NavigationAgent' | 'WebsiteInfoAgent' | string; // Allows for dynamic or unlisted agents

/**
 * Represents a single step in the backend's thought process during a request.
 * @description Provides transparency into AI reasoning or system execution. Sent to frontend as part of messages or status updates.
 */
export interface ThoughtStep {
    /** An identifier for the processing stage (e.g., 'receiving_input', 'calling_gemini', 'executing_function', 'tool_lookup'). */
    step: string;
    /** A human-readable description of the step being performed. */
    message: string;
    /** ISO timestamp when the step occurred. */
    timestamp: string;
    /** Optional: Additional JSON-serializable details relevant to the step (e.g., function arguments, API endpoint). */
    details?: any;
    /** Optional: The ID of the agent currently performing this thought step. */
    agentId?: AgentId;
}

// --- Frontend Action Payloads & Discriminated Union ---

/**
 * Payload for the 'displayList' frontend action.
 * @description Instructs the frontend to display a list of items.
 */
export interface DisplayListPayload {
    /** An array of items to display. Should be cast to a more specific type on the frontend (e.g., `FollowableItem[]`). */
    items: any[]; // Consider (FollowableItem[] | CalendarItem[] | BlacklistItem[]) if a common base isn't feasible
    /** The type of items in the list (e.g., 'conference', 'journal'). */
    itemType: 'conference' | 'journal' | string; // Allow string for extensibility
    /** Describes the nature of the list (e.g., 'followed', 'calendar', 'searchResults'). */
    listType: 'followed' | 'calendar' | 'blacklist' | 'searchResults' | string;
    /** Optional title to display above the list. */
    title?: string;
}

/**
 * Payload for the 'addToCalendar' frontend action.
 * @description Contains all necessary details to create a calendar event on the client side.
 */
export interface AddToCalendarPayload {
    /** The unique ID of the conference to add. */
    conferenceId: string; // Corresponds to CalendarItem.id
    /** Comprehensive details of the conference required for calendar event creation. */
    conferenceDetails: {
        id: string;
        title: string;
        acronym?: string;
        startDate?: string; // ISO string format (e.g., 'YYYY-MM-DD')
        endDate?: string;   // ISO string format
        startTime?: string; // Optional time (e.g., "10:00")
        endTime?: string;   // Optional time (e.g., "18:00")
        timezone?: string;  // Optional timezone (e.g., "America/New_York")
        location?: string;  // Text description of the event's physical location
        description?: string; // Summary or detailed description of the conference
        url?: string; // Link to the conference website
    };
}

/**
 * Payload for the 'removeFromCalendar' frontend action.
 * @description Contains details needed to remove a calendar event.
 */
export interface RemoveFromCalendarPayload {
    /** The unique ID of the conference to remove from the calendar. */
    conferenceId: string; // Corresponds to CalendarItem.id
    /** Optional: A specific calendar event ID, if needed to uniquely identify the event in a calendar provider. */
    calendarEventId?: string;
}

/**
 * Payload for the 'displayConferenceSources' frontend action.
 * @description Instructs frontend to display a list of conferences with their ranking sources.
 */
export interface DisplayConferenceSourcesPayload {
    conferences: Array<{
        id: string;
        title: string;
        acronym?: string;
        rank?: string;
        source?: string;
        conferenceDates?: string; // Pre-formatted date string
        location?: string;      // Pre-formatted location string
    }>;
    title?: string;
}

/**
 * Payload for the 'itemFollowStatusUpdated' frontend action.
 * @description Informs frontend about a change in an item's follow status.
 */
export interface ItemFollowStatusUpdatePayload {
    /** The item whose follow status was updated. */
    item: FollowableItem; // Use the unified FollowableItem
    /** The type of the item. */
    itemType: 'conference' | 'journal';
    /** True if the item is now followed, false if unfollowed. */
    followed: boolean;
}

/**
 * Payload for the 'itemBlacklistStatusUpdated' frontend action.
 * @description Informs frontend about a change in an item's blacklist status.
 */
export interface ItemBlacklistStatusUpdatePayload {
    /** The item whose blacklist status was updated. */
    item: BlacklistItem; // Use the unified BlacklistItem
    /** The type of the item (currently always 'conference' for blacklist). */
    itemType: 'conference';
    /** True if the item is now blacklisted, false if removed from blacklist. */
    blacklisted: boolean;
}

/**
 * Payload for the 'itemCalendarStatusUpdated' frontend action.
 * @description Informs frontend about a change in an item's calendar status.
 */
export interface ItemCalendarStatusUpdatePayload {
    /** The item whose calendar status was updated. */
    item: CalendarItem; // Use the unified CalendarItem
    /** The type of the item (currently always 'conference' for calendar). */
    itemType: 'conference';
    /** True if the item is now added to calendar, false if removed. */
    calendar: boolean; // 'addedToCalendar' might be more descriptive
}

/**
 * Payload for the 'confirmEmailSend' frontend action.
 * @description Contains details for the frontend to display an email confirmation dialog.
 */
export interface ConfirmSendEmailActionPayload {
    /** A unique identifier for this specific confirmation request. */
    confirmationId: string;
    /** The subject line for the email. */
    subject: string;
    /** The type of email request. */
    requestType: 'contact' | 'report' | string; // Allow string for extensibility
    /** The main body/message content of the email. */
    message: string;
    /** The duration (in milliseconds) the confirmation dialog should remain open. */
    timeoutMs: number;
}

/**
 * Defines the types of actions the backend can request the frontend to perform.
 * @description This is a discriminated union type, where `type` distinguishes different actions.
 * It's typically part of `ChatHistoryItem` or `ResultUpdate`.
 */
export type FrontendAction =
    | { type: 'navigate'; url: string }
    | { type: 'openMap'; location: string }
    | { type: 'confirmEmailSend'; payload: ConfirmSendEmailActionPayload }
    | { type: 'displayList'; payload: DisplayListPayload }
    | { type: 'displayConferenceSources'; payload: DisplayConferenceSourcesPayload }
    | { type: 'addToCalendar'; payload: AddToCalendarPayload }
    | { type: 'removeFromCalendar'; payload: RemoveFromCalendarPayload }
    | { type: 'itemFollowStatusUpdated'; payload: ItemFollowStatusUpdatePayload }
    | { type: 'itemBlacklistStatusUpdated'; payload: ItemBlacklistStatusUpdatePayload }
    | { type: 'itemCalendarStatusUpdated'; payload: ItemCalendarStatusUpdatePayload }
    | undefined; // Represents no action being requested.


// --- Socket Event Payloads (Client -> Server) ---

/**
 * Data structure for sending a new message from client to server.
 * @event 'send_message'
 */
export interface SendMessagePayload {
    /** Array of content parts (text, image, file URI) for the message. */
    parts: Part[];
    /** Flag indicating if the response should be streamed (defaults to true if omitted by client). */
    isStreaming?: boolean;
    /** The language context for the message. */
    language: Language;
    /** Optional: The ID of the conversation. If null/undefined, a new conversation is started. */
    conversationId: string | null | undefined;
    /** A unique ID generated by the frontend for this user message, used for optimistic updates and tracking. */
    frontendMessageId: string;
    /** Optional: User personalization data. */
    personalizationData?: PersonalizationPayload | null;
    /**
     * Optional: Array of original file information for files included in `parts`.
     * Provides metadata like original name and size, complementing `parts[].fileData.fileUri`.
     */
    originalUserFiles?: OriginalUserFileInfo[];
}

/**
 * Data structure for editing a user message, sent from client to server.
 * @event 'edit_message'
 */
export interface EditMessagePayload {
    /** The ID of the conversation containing the message to edit. */
    conversationId: string;
    /** The UUID of the specific user message to be edited. */
    messageIdToEdit: string;
    /** The new text content for the user message. (Currently only text edit is supported). */
    newText: string;
    /** The language context of the conversation. */
    language: Language;
    /** Optional: User personalization data, in case it influences the re-generation. */
    personalizationData?: PersonalizationPayload | null;
}

/**
 * Data structure for requesting to load a specific conversation's history, from client to server.
 * @event 'load_conversation'
 */
export interface LoadConversationPayload {
    /** The unique ID of the conversation to load. */
    conversationId: string;
}

/**
 * Data structure for email confirmation/cancellation events, from client to server.
 * @event 'confirm_action' or 'cancel_action' (example event names)
 */
export interface UserConfirmationResponsePayload {
    /** The unique ID of the confirmation process being responded to. Matches `ConfirmSendEmailActionPayload.confirmationId`. */
    confirmationId: string;
    // confirmed: boolean; // Implicit by event name ('confirm_action' vs 'cancel_action') or an explicit field
}

/**
 * Data structure for requesting to delete a conversation, from client to server.
 * @event 'delete_conversation'
 */
export interface DeleteConversationPayload {
    /** The unique ID of the conversation to delete. */
    conversationId: string;
}

/**
 * Data structure for requesting to clear all messages from a conversation, from client to server.
 * @event 'clear_conversation'
 */
export interface ClearConversationPayload {
    /** The unique ID of the conversation whose messages should be cleared. */
    conversationId: string;
}

/**
 * Data structure for requesting to rename a conversation, from client to server.
 * @event 'rename_conversation'
 */
export interface RenameConversationPayload {
    /** The unique ID of the conversation to rename. */
    conversationId: string;
    /** The new title for the conversation. */
    newTitle: string;
}

/**
 * Data structure for requesting to pin or unpin a conversation, from client to server.
 * @event 'pin_conversation'
 */
export interface PinConversationPayload {
    /** The unique ID of the conversation to pin/unpin. */
    conversationId: string;
    /** Boolean indicating the new pinned status (true for pinned, false for unpinned). */
    isPinned: boolean;
}

/**
 * Data structure for requesting to search conversations, from client to server.
 * @event 'search_conversations'
 */
export interface SearchConversationsPayload {
    /** The search term or query string. */
    searchTerm: string;
    /** Optional: Limit the number of search results returned. */
    limit?: number;
}


// --- Socket Event Payloads (Server -> Client - Updates & Specific Events) ---

/**
 * Represents a status update message sent from backend to frontend during processing.
 * @event 'status_update' (example event name)
 * @description Provides real-time feedback on long-running operations.
 */
export interface StatusUpdatePayload {
    /** Always 'status' for discrimination if part of a larger union, otherwise identified by event name. */
    type: 'status';
    /** Identifier for the current processing stage (e.g., 'thinking', 'fetching_data'). */
    step: string;
    /** User-friendly message describing the current status. */
    message: string;
    /** Optional: Additional details relevant to this status update. */
    details?: any;
    /** Optional: The accumulated thought process steps up to this point. */
    thoughts?: ThoughtStep[];
    /** Optional: ISO timestamp of when the update was generated. */
    timestamp?: string;
    /** Optional: The ID of the agent providing this status update. */
    agentId?: AgentId;
}

/**
 * Represents a chunk of text/data sent from backend to frontend during streaming responses.
 * @event 'chat_update' or 'partial_result' (example event name)
 * @description Allows for live display of AI-generated content.
 */
export interface ChatStreamUpdatePayload {
    /** Always 'partial_result' for discrimination if part of a larger union. */
    type: 'partial_result';
    /** The piece of text generated in this chunk. */
    textChunk?: string;
    /** Optional: For streaming structured parts (e.g., an image part becoming available). */
    parts?: Part[];
    /** Optional: Streamed thought process steps. */
    thoughts?: ThoughtStep[];
}

/**
 * Represents the final result of a chat interaction turn sent to the frontend.
 * @event 'final_result' or 'message_result' (example event name)
 * @description Marks the completion of a bot's response, sending the complete `ChatHistoryItem`.
 */
export interface FinalResultPayload {
    /** Always 'result' for discrimination if part of a larger union. */
    type: 'result';
    /** The complete bot message including its UUID, role, parts, thoughts, and action. */
    message: ChatHistoryItem; // Send the full ChatHistoryItem for the bot's response
}

/**
 * Represents an error update sent from the backend to the frontend.
 * @event 'error_update' (example event name)
 * @description Provides details about failures during chat processing.
 */
export interface ErrorUpdatePayload {
    /** Always 'error' for discrimination if part of a larger union. */
    type: 'error';
    /** The primary error message to display to the user. */
    message: string;
    /** Optional: The specific step or stage where the error occurred. */
    step?: string;
    /** Optional: The history of thought steps leading up to the error. */
    thoughts?: ThoughtStep[];
    /** Optional: A specific error code from the server. */
    code?: string;
    /** Optional: Additional JSON-serializable details about the error. */
    details?: any;
}

/**
 * Represents a warning update sent from the backend to the frontend.
 * @event 'warning_update' (example event name)
 * @description Indicates non-critical issues.
 */
export interface WarningUpdatePayload {
    /** Always 'warning' for discrimination if part of a larger union. */
    type: 'warning';
    /** The warning message to display. */
    message: string;
    /** Optional: The processing step where the warning occurred. */
    step?: string;
    /** Optional: The complete thought process leading up to the warning. */
    thoughts?: ThoughtStep[];
}

/**
 * Payload for the 'initial_history' event from backend to frontend upon loading a conversation.
 * @event 'initial_history'
 */
export interface InitialHistoryPayload {
    /** The ID of the conversation whose history is being sent. */
    conversationId: string;
    /** An array of `ChatHistoryItem` objects representing the messages in the conversation. */
    messages: ChatHistoryItem[];
}

/**
 * Payload sent from backend to frontend after a user message has been edited
 * and a new bot response has been generated.
 * @event 'conversation_updated_after_edit'
 */
export interface ConversationUpdatedAfterEditPayload {
    /** The ID of the conversation that was updated. */
    conversationId: string;
    /** The user message with its original UUID but updated content and potentially new timestamp. */
    editedUserMessage: ChatHistoryItem;
    /** The new bot response generated in reply to the edited user message. */
    newBotMessage: ChatHistoryItem;
}

/**
 * Payload informing the frontend about the result of a user confirmation action (e.g., email send).
 * @event 'confirmation_result'
 */
export interface ConfirmationResultPayload {
    /** The ID matching the original confirmation request. */
    confirmationId: string;
    /** The outcome status of the confirmation process. */
    status:
    | 'confirmed' // User clicked confirm, backend action succeeded (or attempted)
    | 'cancelled' // User clicked cancel/dismiss
    | 'timeout'   // Confirmation window expired without user input
    | 'not_found' // Backend couldn't find a pending confirmation with this ID
    | 'failed'    // User confirmed, but subsequent backend action failed
    | 'unauthorized' // Attempt to confirm/cancel by wrong user/session
    | 'error';    // Internal server error during confirmation processing
    /** A user-friendly message summarizing the outcome. */
    message: string;
    /** Optional: Additional details, especially for 'failed' or 'error' statuses. */
    details?: any;
}

/**
 * Payload for the result of a conversation renaming operation, sent from server to client.
 * This can be a direct response to a rename request or a broadcast event.
 * @event 'conversation_renamed' (if broadcast) or part of ack callback.
 */
export interface RenameConversationResultPayload {
    /** Indicates if the rename operation was successful. */
    success: boolean;
    /** The ID of the conversation that was (or attempted to be) renamed. */
    conversationId: string;
    /** The updated (and potentially normalized) title of the conversation. Present on success. */
    updatedTitle?: string;
    /** An error message if the operation failed. Present on failure. */
    errorMessage?: string;
}

/**
 * Payload for when a conversation is deleted, sent from server to client to update UI.
 * @event 'conversation_deleted'
 */
export interface ConversationDeletedPayload {
    /** The ID of the conversation that was deleted. */
    conversationId: string;
}

/**
 * Payload for when a conversation is cleared, sent from server to client.
 * @event 'conversation_cleared'
 */
export interface ConversationClearedPayload {
    /** The ID of the conversation whose messages were cleared. */
    conversationId: string;
}

/**
 * Payload for when a conversation's pin status changes, sent from server to client.
 * @event 'conversation_pin_status_changed'
 */
export interface ConversationPinStatusChangedPayload {
    /** The ID of the conversation whose pin status changed. */
    conversationId: string;
    /** The new pinned status. */
    isPinned: boolean;
}


// --- Conversation Management Types ---

/**
 * Metadata for a conversation, typically for displaying in a list.
 * @description Sent from backend to client.
 */
export interface ConversationMetadata {
    /** The unique ID of the conversation. */
    id: string;
    /** The title of the conversation (can be user-set or auto-generated). */
    title: string;
    /** The timestamp of the last activity in the conversation. Use Date object; frontend can format. */
    lastActivity: Date;
    /** Boolean indicating if the conversation is pinned. */
    isPinned: boolean;
    // snippet?: string; // Optional: for search results, a small piece of content.
}

/**
 * Result structure for creating a new conversation, sent from backend to client.
 * @description Contains all necessary details for the frontend to initialize the new conversation.
 */
export interface NewConversationResult {
    /** The unique ID of the newly created conversation. */
    conversationId: string;
    /** The initial history of the new conversation (often empty or with a system greeting). */
    history: ChatHistoryItem[];
    /** The initial title of the new conversation. */
    title: string;
    /** The timestamp of the new conversation's creation. */
    lastActivity: Date;
    /** Boolean indicating if the new conversation is pinned (usually false by default). */
    isPinned: boolean;
}

// --- Agent-to-Agent Communication Types (Backend Internal) ---

/**
 * Represents a request sent between different AI agents (e.g., Host Agent to Conference Agent).
 * @description Defines the communication protocol for internal task delegation within the backend.
 */
export interface AgentCardRequest {
    /** Unique ID for this specific task request (e.g., UUID). */
    taskId: string;
    /** ID of the overarching conversation to which this task belongs. */
    conversationId: string;
    /** ID of the agent sending the request. */
    senderAgentId: AgentId;
    /** ID of the agent designated to handle this request. */
    receiverAgentId: AgentId;
    /** ISO timestamp of when the request was created. */
    timestamp: string;
    /** Natural language description of the task for the receiving agent. */
    taskDescription: string;
    /** Optional context to provide the receiving agent. */
    context?: {
        history?: ChatHistoryItem[];
        userToken?: string | null;
        language?: Language;
    };
}

/**
 * Represents a response sent back from a receiving agent to the sender (Backend Internal).
 * @description Concludes a delegated task and returns results or errors.
 */
export interface AgentCardResponse {
    /** The ID of the original task request this response corresponds to. */
    taskId: string;
    /** ID of the overarching conversation. */
    conversationId: string;
    /** ID of the agent sending this response. */
    senderAgentId: AgentId;
    /** ID of the intended recipient of the response (e.g., 'HostAgent'). */
    receiverAgentId: AgentId;
    /** ISO timestamp of when the response was created. */
    timestamp: string;
    /** The status indicating the outcome of the task processing. */
    status: 'success' | 'error' | 'in_progress';
    /** Optional data containing the result of the task. */
    resultData?: any;
    /** Optional error message if the status is 'error'. */
    errorMessage?: string;
    /** Optional action requested by the sub-agent for the frontend to perform. */
    frontendAction?: FrontendAction;
    /** Optional: The thought process steps generated by the sub-agent. */
    thoughts?: ThoughtStep[];
}

// --- Function Handler (Gemini Tool) Types (Backend Internal) ---

/**
 * Input context provided to each function handler during Gemini tool execution (Backend Internal).
 */
export interface FunctionHandlerInput {
    /** Arguments extracted by the LLM for the function call. */
    args: Record<string, any>;
    /** Authentication token for the user, if available. */
    userToken: string | null;
    /** The current language setting for the interaction. */
    language: Language;
    /** A unique identifier for this specific function execution instance. */
    handlerId: string;
    /** The unique ID of the client's Socket.IO connection. */
    socketId: string;
    /** Callback function to send real-time status updates. */
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdatePayload) => boolean;
    /** The raw Socket.IO client socket instance. */
    socket: Socket;
    /** Optional: The name of the function being executed. */
    functionName?: string;
    /** Optional: Any additional context passed down. */
    executionContext?: any;
    /** Optional: The ID of the agent executing this function. */
    agentId?: AgentId;
}

/**
 * Output structure expected from every function handler after execution (Backend Internal).
 * @description This response is used by the LLM orchestrator.
 */
export interface FunctionHandlerOutput {
    /** The response content formulated for the LLM to inform its next generation. */
    modelResponseContent: string;
    /** Optional action to be triggered on the frontend UI. */
    frontendAction?: FrontendAction;
    /** Optional: The thought process steps generated during the function's execution. */
    thoughts?: ThoughtStep[];
}

// --- Frontend UI Helper Types (Primarily for Frontend State Management) ---

/**
 * Represents the loading state in the frontend UI.
 */
export interface LoadingState {
    isLoading: boolean;
    step: string; // Current step description from backend StatusUpdatePayload.step
    message: string; // Current message from backend StatusUpdatePayload.message
    agentId?: AgentId;
}

/**
 * Generic information about an item, potentially for confirmation dialogs (less specific than ConfirmSendEmailActionPayload).
 * @description Could be used by frontend if a generic confirmation mechanism is needed.
 */
export interface GenericItemConfirmationInfo {
    /** Unique identifier for the item or action. */
    itemId: string;
    /** Subject or title for the confirmation. */
    subject: string;
    /** Type of request related to the item. */
    requestType: string;
    /** Main message body or details for the confirmation. */
    message: string;
    /** Timeout duration for a confirmation dialog, if applicable. */
    timeoutMs?: number;
}


// --- Constants ---

/**
 * An array of available language options for UI selection.
 */
export const AVAILABLE_LANGUAGES: LanguageOption[] = [
    { name: 'English', code: 'en', flagCode: 'gb' },
    { name: 'Deutsch', code: 'de', flagCode: 'de' },
    { name: 'Français', code: 'fr', flagCode: 'fr' },
    { name: 'Tiếng Việt', code: 'vi', flagCode: 'vn' },
    { name: 'Español', code: 'es', flagCode: 'es' },
    { name: 'Русский', code: 'ru', flagCode: 'ru' },
    { name: '中文', code: 'zh', flagCode: 'cn' },
    { name: '日本語', code: 'ja', flagCode: 'jp' },
    { name: '한국어', code: 'ko', flagCode: 'kr' },
    { name: 'العربية', code: 'ar', flagCode: 'sa' },
];

/**
 * The default language used if none is specified or detected.
 */
export const DEFAULT_LANGUAGE: Language = 'vi';

/**
 * The default prebuilt voice used for text-to-speech.
 */
export const DEFAULT_VOICE: PrebuiltVoice = 'Puck';

/**
 * The default output modality for AI responses.
 */
export const DEFAULT_MODALITY: OutputModality = 'audio'; // Or 'text' depending on your default