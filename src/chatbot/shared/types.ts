// src/chatbot/shared/types.ts

import { Socket } from "socket.io"; // Socket.IO types for handler context
import { FunctionCall, Part } from "@google/genai";

// --- Basic Utility Types ---

/**
 * Represents the set of supported natural languages in the application.
 */
export type Language = 'en' | 'vi' | 'zh' | 'de' | 'fr' | 'es' | 'ru' | 'ja' | 'ko' | 'ar'; // Extend as needed

/**
 * Represents the available prebuilt voices for text-to-speech functionality.
 */
export type PrebuiltVoice = "Puck" | "Charon" | "Kore" | "Fenrir" | "Aoede" | "Orus" | "Zephyr";

/**
 * Defines the possible output modalities for AI responses.
 */
export type OutputModality = "text" | "audio" | "image";

/**
 * Defines the chat interaction mode, indicating if responses should be streamed live or sent as a single block.
 */
export type ChatMode = 'live' | 'regular';

/**
 * Defines the structure for a language option presented to the user in the UI.
 */
export interface LanguageOption {
    /** The language code (e.g., 'en' for English). */
    code: Language;
    /** The human-readable name of the language (e.g., 'English'). */
    name: string;
    /** The flag code for displaying country flag icons (e.g., 'gb' for Great Britain, 'vn' for Vietnam). */
    flagCode: string;
}

/**
 * Defines the structure for a single item in the conversation history,
 * directly compatible with Google AI SDK's content structure.
 */
export interface ChatHistoryItem {
    /** The role of the entity that produced this part of the conversation (e.g., 'user', 'model', 'function'). */
    role: "user" | "model" | "function";
    /** The content parts, directly using the Google AI SDK's Part type (e.g., text, inline_data, function_call, function_response). */
    parts: Part[];
    /** Optional ISO timestamp indicating when the history item was created/added. */
    timestamp?: string | Date;
    /** Optional unique identifier for this history item (e.g., UUID for messages). */
    uuid?: string;
    thoughts?: ThoughtStep[]; // Optional: Model's thought process
    action?: FrontendAction;  // Optional: Action requested by the model
    // Thông tin file gốc của người dùng, chỉ có ý nghĩa với role: 'user'
    userFileInfo?: OriginalUserFileInfo[];
}


// --- API & Service Result Types ---

/**
 * Represents the generic result structure for an internal API call or service operation.
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

/**
 * Defines the date range for an item, typically for conferences or journals.
 */
export interface ItemDateRange {
    /** The start date of the item, in ISO Date string format. */
    fromDate: string;
    /** The end date of the item, in ISO Date string format. */
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
export interface FollowItem {
    /** The unique identifier of the item. */
    id: string;
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
    /** The type of the item. */
    itemType?: "conference" | "journal";
    // Additional fields can be added here as needed for specific item types.
    // E.g., `websiteUrl?: string;` for conferences, `publisher?: string;` for journals.
}


/**
 * Represents a generic item (e.g., conference) that can be blacklisted by a user.
 * Dữ liệu blacklist API có vẻ vẫn dùng conferenceId, nên giữ nguyên.
 */
export interface BlacklistItem {
    /** The unique identifier of the item (e.g., conference ID) in the blacklist context. */
    conferenceId: string; // Tên thuộc tính trong API nhận blacklist
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
}


/**
 * Represents a generic item (e.g., conference) that can be added to a user's calendar.
 */
// src/shared/types.ts (hoặc nơi bạn định nghĩa CalendarItem)
export interface CalendarItem {
    /** The unique identifier of the conference event. */
    id: string; // Tên thuộc tính trong API là 'id'
    /** The title or name of the conference. */
    title: string; // Tên thuộc tính trong API là 'title'
    /** Optional acronym or abbreviation. */
    acronym?: string;
    /** The unique identifier of the creator. */
    creatorId: string | null;
    /** The unique identifier of the administrator. */
    adminId: string;
    /** ISO timestamp when the item was followed. */
    followedAt: string;
    /** ISO timestamp when the item was last updated. */
    updatedAt: string;
    /** The status of the item (e.g., "CRAWLED"). */
    status: string;
    /** Optional date range associated with the item. */
    dates: ItemDateRange;
    /** Optional location details for the item. */
    location: {
        address: string;
        cityStateProvince: string;
        country: string;
        continent: string;
    };
    // Thêm các trường khác nếu cần, ví dụ:
    // status?: string;
    // dates?: ItemDateRange;
    // location?: ItemLocation;
}

/**
 * Payload for the 'itemFollowStatusUpdated' frontend action.
 * Contains details of the item whose follow status has changed.
 */
export interface ItemFollowStatusUpdatePayload {
    /** The item whose follow status was updated. */
    item: FollowItem;
    /** The type of the item (e.g., 'conference', 'journal'). */
    itemType: 'conference' | 'journal';
    /** True if the item is now followed (after a 'follow' action), false if unfollowed. */
    followed: boolean;
}

/**
 * Payload for the 'itemBlacklistStatusUpdated' frontend action.
 * Contains details of the item whose blacklist status has changed.
 */
export interface ItemBlacklistStatusUpdatePayload {
    /** The item whose blacklist status was updated. */
    item: BlacklistItem;
    /** The type of the item (e.g., 'conference'). */
    itemType: 'conference';
    /** True if the item is now blacklisted, false if removed from blacklist. */
    blacklisted: boolean;
}

/**
 * Payload for the 'itemCalendarStatusUpdated' frontend action.
 * Contains details of the item whose calendar status has changed.
 */
export interface ItemCalendarStatusUpdatePayload {
    /** The item whose calendar status was updated. */
    item: CalendarItem;
    /** The type of the item (e.g., 'conference'). */
    itemType: 'conference';
    /** True if the item is now added to calendar, false if removed from calendar. */
    calendar: boolean;
}

// --- Gemini Model Interaction Types ---

/**
 * Defines the possible outcomes of a single interaction turn with the Gemini model.
 */
export interface GeminiInteractionResult {
    /** The status indicating the outcome of the generation attempt. */
    status: "requires_function_call" | "final_text" | "error";
    /** The function call requested by the model (present if status is 'requires_function_call'). */
    functionCall?: FunctionCall;
    /** The final text response generated by the model (present if status is 'final_text'). */
    text?: string;
    /** Optional: The full structured parts from the model's response, especially if it's multimodal. */
    parts?: Part[]; // <<< ADDED
    /** An error message if the generation failed (present if status is 'error'). */
    errorMessage?: string;
}


// --- Frontend Interaction & Updates Types ---

/**
 * Payload for the 'displayList' frontend action.
 * Used to instruct the frontend to display a list of items.
 */
export interface DisplayListPayload {
    /** An array of items to display. Can be `FollowItem[]`, `CalendarItem[]`, etc. */
    // Using `any[]` for broad compatibility, but consider a specific union type if possible:
    // `(FollowItem[] | CalendarItem[])`
    items: any[];
    /** The type of items in the list (e.g., 'conference', 'journal'). */
    itemType: 'conference' | 'journal';
    /** Describes the nature of the list (e.g., 'followed', 'calendar', 'searchResults'). */
    listType: 'followed' | 'calendar' | string;
    /** Optional title to display above the list. */
    title?: string;
}

/**
 * Payload for the 'addToCalendar' frontend action.
 * Contains all necessary details to create a calendar event on the client side.
 */
export interface AddToCalendarPayload {
    /** The unique ID of the conference to add. */
    conferenceId: string;
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
        // Add any other fields your specific calendar integration requires.
    };
}

/**
 * Payload for the 'removeFromCalendar' frontend action.
 * Contains details needed to remove a calendar event.
 */
export interface RemoveFromCalendarPayload {
    /** The unique ID of the conference to remove from the calendar. */
    conferenceId: string;
    /** Optional: A specific calendar event ID, if needed to uniquely identify the event in a calendar provider. */
    calendarEventId?: string;
}

// Định nghĩa payload cho action hiển thị nguồn hội nghị
export interface DisplayConferenceSourcesPayload {
    conferences: Array<{
        id: string;
        title: string;
        acronym?: string; // Tên viết tắt có thể không có
        rank?: string;    // Rank có thể không có hoặc là 'N/A'
        source?: string;  // Nguồn rank
        conferenceDates?: string; // Chuỗi ngày đã được format, ví dụ: "May 10 - 12, 2024"
        location?: string; // Chuỗi địa điểm đã được format
        // Thêm các trường khác nếu bạn muốn hiển thị trên card ở frontend
    }>;
    title?: string; // Tiêu đề cho phần hiển thị này, ví dụ: "Conferences Found"
}

/**
 * Defines the types of actions the backend can request the frontend to perform.
 * This is a discriminated union type, where `type` distinguishes different actions.
 */
export type FrontendAction =
    | { type: 'navigate'; url: string } // Instructs frontend to navigate to a URL.
    | { type: 'openMap'; location: string } // Instructs frontend to open a map to a specific location.
    | { type: 'confirmEmailSend'; payload: ConfirmSendEmailAction } // Asks frontend to show an email confirmation dialog.
    | { type: 'displayList'; payload: DisplayListPayload } // Instructs frontend to display a list of items.
    | { type: 'displayConferenceSources'; payload: DisplayConferenceSourcesPayload } // <<< ACTION MỚI
    | { type: 'addToCalendar'; payload: AddToCalendarPayload } // Instructs frontend to add an item to calendar.
    | { type: 'removeFromCalendar'; payload: RemoveFromCalendarPayload } // Instructs frontend to remove an item from calendar.
    | { type: 'itemFollowStatusUpdated'; payload: ItemFollowStatusUpdatePayload } // Informs frontend about a change in item's follow status.
    | { type: 'itemBlacklistStatusUpdated'; payload: ItemBlacklistStatusUpdatePayload } // Informs frontend about a change in item's blacklist status.
    | { type: 'itemCalendarStatusUpdated'; payload: ItemCalendarStatusUpdatePayload } // Informs frontend about a change in item's calendar status.
    | undefined; // Represents no action being requested.

/**
 * Defines the payload for the 'confirmEmailSend' frontend action.
 * Contains details necessary for the frontend to display an email confirmation dialog.
 */
export interface ConfirmSendEmailAction {
    /** A unique identifier for this specific confirmation request, used to track user response. */
    confirmationId: string;
    /** The subject line for the email to be sent. */
    subject: string;
    /** The type of email request (e.g., 'contact', 'report', 'summary'). */
    requestType: 'contact' | 'report';
    /** The main body/message content of the email. */
    message: string;
    /** The duration (in milliseconds) the confirmation dialog should remain open for user input. */
    timeoutMs: number;
}

/**
 * Defines generic information about an item, potentially for confirmation.
 * This looks similar to `ConfirmSendEmailAction` but might be for other item-related confirmations.
 */
export interface ItemInfo {
    /** Unique identifier for the item. */
    itemId: string;
    /** Subject line, potentially for an email or notification. */
    subject: string;
    /** Type of request related to the item (e.g., 'contact', 'report'). */
    requestType: 'contact' | 'report' | string;
    /** Main message body or details related to the item. */
    message: string;
    /** Timeout duration for a confirmation dialog, if applicable. */
    timeoutMs: number;
}

/**
 * Represents a single step in the backend's thought process during a request,
 * providing transparency into AI reasoning or system execution.
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

/**
 * Defines possible identifiers for different AI agents or modules within the system.
 */
export type AgentId = 'HostAgent' | 'ConferenceAgent' | 'JournalAgent' | 'AdminContactAgent' | 'NavigationAgent' | 'WebsiteInfoAgent' | string; // Allows for dynamic or unlisted agents

/**
 * Represents a status update message sent from the backend to the frontend during processing.
 * Used to provide real-time feedback on long-running operations.
 */
export interface StatusUpdate {
    /** Always 'status' for discrimination. */
    type: 'status';
    /** Identifier for the current processing stage (e.g., 'thinking', 'fetching_data'). */
    step: string;
    /** User-friendly message describing the current status to display. */
    message: string;
    /** Optional: Additional details relevant to this specific status update. */
    details?: any;
    /** Optional: The accumulated thought process steps up to this point. */
    thoughts?: ThoughtStep[];
    /** Optional but recommended: ISO timestamp of when the update was generated. */
    timestamp?: string;
    /** Optional: The ID of the agent providing this status update. */
    agentId?: AgentId;
}

/**
 * Represents a chunk of text sent from the backend to the frontend during streaming responses.
 * This allows for live display of AI-generated text.
 */
export interface ChatUpdate {
    /** Always 'partial_result' for discrimination. */
    type: 'partial_result';
    /** The piece of text generated in this chunk. */
    textChunk: string;
    /** Optional: For streaming structured parts (more complex) */
    parts?: Part[];

}

/**
 * Represents the final result of a chat interaction turn sent to the frontend.
 * This marks the completion of a bot's response.
 */
export interface ResultUpdate {
    /** Always 'result' for discrimination. */
    type: 'result';
    /** Optional: The unique identifier of the final bot message in the backend history. */
    id?: string;
    /** The complete final text message to display to the user. */
    message: string;
    /** Optional: Full structured parts from the model */
    parts?: Part[];
    /** Optional: The complete thought process that led to this result. */
    thoughts?: ThoughtStep[];
    /** Optional: An action for the frontend to perform alongside displaying the message. */
    action?: FrontendAction;
}

/**
 * Represents an error update sent from the backend to the frontend.
 * Provides details about failures during chat processing.
 */
export interface ErrorUpdate {
    /** Always 'error' for discrimination. */
    type: 'error';
    /** The primary error message to display to the user. */
    message: string;
    /** Optional: The specific step or stage where the error occurred (e.g., 'tool_execution', 'final_formatting'). */
    step?: string;
    /** Optional: The history of thought steps leading up to the error. */
    thoughts?: ThoughtStep[];
    /** Optional: A specific error code from the server (e.g., 'CONVERSATION_NOT_FOUND', 'AUTH_REQUIRED'). */
    code?: string;
    /** Optional: Additional JSON-serializable details about the error. */
    details?: any;
}

/**
 * Represents a warning update sent from the backend to the frontend.
 * Indicates non-critical issues that the user might need to be aware of.
 */
export interface WarningUpdate {
    /** Always 'warning' for discrimination. */
    type: 'warning';
    /** The warning message to display to the user. */
    message: string;
    /** Optional: The processing step where the warning occurred. */
    step?: string;
    /** Optional: The complete thought process leading up to the warning. */
    thoughts?: ThoughtStep[];
}

/**
 * Defines the possible display types for a message rendered in the chat UI.
 */
export type ChatDisplayMessageType = 'text' | 'error' | 'warning' | 'map' | 'follow_update' | 'blacklist_update' | 'calendar_update' | undefined;

/**
 * Represents a single message object used for rendering the chat history in the UI.
 * This is the frontend-facing message format.
 */
export interface ChatMessage {
    /** A unique identifier for the message (e.g., generated by UUID). */
    id: string;
    /** The primary text content of the message (can be a label for a map or other complex types). */
    message: string;
    /** Flag indicating if the message originated from the user (`true`) or the bot/system (`false`). */
    isUser: boolean;
    /** The display type of the message, dictating how it should be rendered. */
    type: ChatDisplayMessageType;
    /** Optional: Accumulated thought steps associated with this message's generation. */
    thoughts?: ThoughtStep[];
    /** Optional: Location string used if the message type is 'map'. */
    location?: string;
    /** Optional: Timestamp when the message was created/received, in ISO string or Date object format. */
    timestamp?: string | Date;
}



/**
 * Payload informing the frontend about the result of a user confirmation action (e.g., email send, item action).
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
    | 'failed'    // User confirmed, but subsequent backend action failed (e.g., sending email)
    | 'unauthorized' // Attempt to confirm/cancel by wrong user/session
    | 'error';    // Internal server error during confirmation processing
    /** A user-friendly message summarizing the outcome. */
    message: string;
    /** Optional: Additional details, especially for 'failed' or 'error' statuses. */
    details?: any;
}

// --- Agent Communication Protocol (Inter-agent messaging) ---

/**
 * Represents a request sent between different AI agents (e.g., Host Agent to Conference Agent).
 * This defines the communication protocol for internal task delegation.
 */
export interface AgentCardRequest {
    /** Unique ID for this specific task request (e.g., UUID). */
    taskId: string;
    /** ID of the overarching conversation to which this task belongs. */
    conversationId: string;
    /** ID of the agent sending the request (e.g., 'HostAgent', 'ConferenceAgent'). */
    senderAgentId: 'HostAgent' | string;
    /** ID of the agent designated to handle this request. */
    receiverAgentId: string;
    /** ISO timestamp of when the request was created. */
    timestamp: string;
    /** Natural language description of the task for the receiving agent. */
    taskDescription: string;
    /** Optional context to provide the receiving agent, aiding in task execution. */
    context?: {
        history?: ChatHistoryItem[]; // e.g., last few messages relevant to the task
        userToken?: string | null; // User's authentication token for authenticated tool calls
        language?: Language; // Language preference for the task
    };
}

/**
 * Represents a response sent back from a receiving agent to the sender.
 * This concludes a delegated task and returns results or errors.
 */
export interface AgentCardResponse {
    /** The ID of the original task request this response corresponds to. */
    taskId: string;
    /** ID of the overarching conversation. */
    conversationId: string;
    /** ID of the agent sending this response. */
    senderAgentId: string;
    /** ID of the intended recipient of the response (e.g., 'HostAgent'). */
    receiverAgentId: 'HostAgent' | string;
    /** ISO timestamp of when the response was created. */
    timestamp: string;
    /** The status indicating the outcome of the task processing. */
    status: 'success' | 'error' | 'in_progress';
    /** Optional data containing the result of the task (e.g., JSON string, text summary, tool outputs). */
    resultData?: any;
    /** Optional error message if the status is 'error'. */
    errorMessage?: string;
    /** Optional action requested by the sub-agent for the frontend to perform (e.g., navigate). */
    frontendAction?: FrontendAction;
    /** Optional: The thought process steps generated by the sub-agent during task execution. */
    thoughts?: ThoughtStep[];
}


// --- Socket Event Data Payloads (Data sent between client and server via Socket.IO) ---


export interface OriginalUserFileInfo {
    name: string;
    size: number;
    type: string;
    googleFileUri: string; // URI từ Google File API sau khi upload, frontend nên đảm bảo có
    // dataUrl không cần thiết ở backend cho mục đích này
}

/**
 * Data structure expected when the client sends a new message to the chatbot.
 */
export interface SendMessageData {
    // userInput: string; // <<< OLD: Will be replaced by parts
    parts: Part[]; // <<< NEW: Array of content parts (text, image, file)
    /** Flag indicating if the response should be streamed (defaults to true if omitted). */
    isStreaming?: boolean;
    /** The language context for the message. */
    language: Language;
    /** Optional: The ID of the conversation to send the message to. If null/undefined, a new conversation is started. */
    conversationId: string | null | undefined;
    /** Optional: A unique ID generated by the frontend for this message, used for tracking. */
    frontendMessageId?: string;
    /** Optional: User personalize data */
    personalizationData?: PersonalizationPayload | null; // <<< ADDED
    originalUserFiles?: OriginalUserFileInfo[]; // Thêm trường này


}



// Define the PersonalizationPayload if it's not already here
// This should match the one on the frontend
export interface PersonalizationPayload {
    firstName?: string;
    lastName?: string;
    aboutMe?: string;
    interestedTopics?: string[];
}

/**
 * Data structure for editing a user message.
 * For now, assumes only text content of a message can be edited.
 * If multimodal edits were allowed, this would need `newParts: Part[]`.
 */
export interface BackendEditUserMessagePayload {
    conversationId: string;
    messageIdToEdit: string;
    newText: string; // The new text content for the message
    language: Language;
    // isStreaming is usually derived from socket.data or a global setting on backend
    personalizationData?: PersonalizationPayload | null; // <<< ADDED
}

/**
 * Data structure expected when the client requests to load a specific conversation's history.
 */
export interface LoadConversationData {
    /** The unique ID of the conversation to load. */
    conversationId: string;
}

/**
 * Data structure expected for email confirmation/cancellation events from the client.
 */
export interface ConfirmationEventData {
    /** The unique ID of the confirmation process being responded to by the user. */
    confirmationId: string;
}

/**
 * Data structure expected when the client requests to delete a conversation.
 */
export interface DeleteConversationData {
    /** The unique ID of the conversation to delete. */
    conversationId: string;
}

/**
 * Data structure expected when the client requests to clear all messages from a conversation.
 */
export interface ClearConversationData {
    /** The unique ID of the conversation whose messages should be cleared. */
    conversationId: string;
}

/**
 * Data structure expected when the client requests to rename a conversation.
 */
export interface RenameConversationData {
    /** The unique ID of the conversation to rename. */
    conversationId: string;
    /** The new title for the conversation. */
    newTitle: string;
}


/**
 * Represents the result of a conversation renaming operation.
 */
export interface RenameResult {
    /** Indicates if the rename operation was successful. */
    success: boolean;
    /** Optional: The updated (and potentially normalized) title of the conversation.
     * This field is typically present on success.
     */
    updatedTitle?: string;
    /** Optional: The ID of the conversation that was renamed.
     * This field is typically present for both success and failure cases where the conversation ID is known.
     */
    conversationId?: string;
    /** Optional: An error message providing details if the operation failed.
     * This field is typically present on failure.
     */
    errorMessage?: string; // Thêm trường errorMessage để cung cấp thông tin chi tiết hơn khi lỗi
}

/**
 * Data structure expected when the client requests to pin or unpin a conversation.
 */
export interface PinConversationData {
    /** The unique ID of the conversation to pin/unpin. */
    conversationId: string;
    /** Boolean indicating the new pinned status (true for pinned, false for unpinned). */
    isPinned: boolean;
}

/**
 * Data structure expected when the client requests to search conversations.
 */
export interface SearchConversationsData {
    /** The search term or query string. */
    searchTerm: string;
    /** Optional: Limit the number of search results returned. */
    limit?: number;
}

/**
 * Metadata for a conversation sent to the client, typically for displaying a list of conversations.
 * This is a simplified view of the full `ConversationMetadata` on the backend.
 */
export interface ClientConversationMetadata {
    /** The unique ID of the conversation. */
    id: string;
    /** The title of the conversation. */
    title: string;
    /** The timestamp of the last activity in the conversation. */
    lastActivity: Date; // Use Date object, frontend can format it.
    /** Boolean indicating if the conversation is pinned. */
    isPinned: boolean;
}

/**
 * Result structure for creating a new conversation, containing all necessary details.
 */
export interface NewConversationResult {
    /** The unique ID of the newly created conversation. */
    conversationId: string;
    /** The initial history of the new conversation (often empty or with a system message). */
    history: ChatHistoryItem[];
    /** The initial title of the new conversation. */
    title: string;
    /** The timestamp of the new conversation's creation. */
    lastActivity: Date;
    /** Boolean indicating if the new conversation is pinned (usually false by default). */
    isPinned: boolean;
}

export interface InitialHistoryPayload {
    conversationId: string;
    messages: ChatHistoryItem[]; // <<< THAY ĐỔI: Gửi trực tiếp ChatHistoryItem[]
}

/**
 * Payload for editing a user's message in a conversation.
 * Sent from frontend to backend.
 */
export interface BackendEditUserMessagePayload {
    /** The ID of the conversation containing the message to edit. */
    conversationId: string;
    /** The ID of the specific user message to be edited. */
    messageIdToEdit: string;
    /** The new text content for the user message. */
    newText: string;
    /** The language context of the conversation. */
    language: Language;
}

/**
 * Payload sent from backend to frontend after a user message has been edited
 * and a new bot response has been generated.
 */
export interface BackendConversationUpdatedAfterEditPayload {
    /** The user message with its original ID but updated content. */
    editedUserMessage: ChatHistoryItem;
    /** The new bot response generated in reply to the edited user message. */
    newBotMessage: ChatHistoryItem;
    /** The ID of the conversation that was updated. */
    conversationId: string;
}

// --- Constants ---

/**
 * An array of available language options for UI selection,
 * including their display name, code, and flag code.
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
 * The default language used if none is specified or detected, for example, 'vi' (Vietnamese).
 */
export const DEFAULT_LANGUAGE: Language = 'vi';

/**
 * The default prebuilt voice used for text-to-speech, for example, 'Puck'.
 */
export const DEFAULT_VOICE: PrebuiltVoice = 'Puck';

/**
 * The default output modality for AI responses, for example, 'audio'.
 */
export const DEFAULT_MODALITY: OutputModality = 'audio';

// --- Gemini Specific Types ---

/**
 * Input context provided to each function handler during execution.
 * Contains all necessary data and callbacks for the handler's operation.
 */
export interface FunctionHandlerInput {
    /** Arguments extracted by the LLM for the function call. Structure varies per function. */
    args: Record<string, any>;

    /** Authentication token for the user associated with the request, if available. */
    userToken: string | null;

    /** The current language setting for the interaction (e.g., 'en', 'vi'). */
    language: Language;

    /** A unique identifier for this specific function execution instance (can trace back to parent AI processing). */
    handlerId: string;

    /** The unique ID of the client's Socket.IO connection. */
    socketId: string;

    /**
     * Callback function to send real-time status updates back to the central orchestrator
     * (e.g., `intentHandler.orchestrator`).
     * @param eventName - Should always be 'status_update'.
     * @param data - The `StatusUpdate` payload.
     * @returns `true` if the update was likely sent successfully, `false` if the underlying connection is likely closed.
     */
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdate) => boolean;

    /** The raw Socket.IO client socket instance. Use with caution; prefer `onStatusUpdate` for general logging. */
    socket: Socket;

    /** Optional: The name of the function being executed, passed down from the registry for contextual logging. */
    functionName?: string;

    /** Optional: Any additional context passed down from the calling layer (e.g., agent card context). */
    executionContext?: any;

    /** Optional: The ID of the agent that is currently executing this function handler. */
    agentId?: string;
}

/**
 * Output structure expected from every function handler after execution.
 * This response is typically processed by the LLM orchestrator to formulate the next bot message.
 */
export interface FunctionHandlerOutput {
    /**
     * The response content formulated for the LLM. This typically includes the results of the
     * function's operation or a description of an error. It should guide the LLM on what to say next to the user.
     */
    modelResponseContent: string;

    /**
     * Optional action to be triggered on the frontend UI after the function completes.
     * Examples include navigating to a URL, opening a map, or showing a confirmation dialog.
     */
    frontendAction?: FrontendAction;

    /** Optional: The thought process steps generated during the function's execution. */
    thoughts?: ThoughtStep[];
}