// src/chatbot/services/conversationHistory.service.ts
import mongoose, { Types, Error as MongooseError } from 'mongoose';
import ConversationModel, { IConversation } from '../models/conversation.model';
import { ChatHistoryItem, RenameResult, NewConversationResult, Language } from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility for robust error handling

const LOG_PREFIX = "[HistoryService]";
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_TITLE_LENGTH = 50; // Max length for auto-generated titles
const MAX_CUSTOM_TITLE_LENGTH = 120; // Max length for user-defined titles
const TRUNCATE_SUFFIX = '...'; // Suffix for truncated titles

// Define default titles based on language for new conversations
const DEFAULT_TITLES_BY_LANGUAGE: { [key: string]: string } = {
    en: "New Chat",                  // English
    vi: "Cuộc trò chuyện mới",       // Vietnamese
    zh: "新对话",                    // Chinese (Simplified) - Assuming Simplified, common for web
    de: "Neuer Chat",               // German
    fr: "Nouvelle discussion",      // French
    es: "Nuevo chat",               // Spanish
    ru: "Новый чат",                // Russian
    ja: "新しいチャット",             // Japanese
    ko: "새 채팅",                   // Korean
    ar: "دردشة جديدة",             // Arabic
};
const FALLBACK_DEFAULT_TITLE = "New Chat"; // Fallback if language not found or not provided


/**
 * Defines the structure for conversation metadata returned to the frontend.
 */
export interface ConversationMetadata {
    id: string;
    title: string;
    lastActivity: Date;
    isPinned: boolean;
    // snippet?: string; // Optional: could add a snippet from a matching message when searching
}

/**
 * Defines the result structure for updating a user's message and preparing history.
 */
export interface UpdateUserMessageResult {
    editedUserMessage?: ChatHistoryItem; // The new, edited user message
    historyForNewBotResponse?: ChatHistoryItem[]; // The history to send to the LLM for a new bot response
    originalConversationFound: boolean; // Flag if the conversation was found
    messageFoundAndIsLastUserMessage: boolean; // Flag if the message was found and was the last user message
}


/**
 * Service responsible for managing user conversation history stored in MongoDB.
 */
export class ConversationHistoryService {
    private readonly model: mongoose.Model<IConversation>;

    /**
     * Constructs a new ConversationHistoryService instance.
     * Initializes the Mongoose model for conversations.
     */
    constructor() {
        this.model = ConversationModel;
        
    }

    /**
     * Retrieves a localized default title for a new conversation based on the provided language.
     * @param {string} [language] - The language code (e.g., 'en', 'vi', 'en-US').
     * @returns {string} The localized default title, or `FALLBACK_DEFAULT_TITLE` if not found.
     */
    private getLocalizedDefaultTitle(language?: string): string {
        if (language) {
            const langKey = language.toLowerCase().slice(0, 2); // Extract base language (e.g., 'en' from 'en-US')
            return DEFAULT_TITLES_BY_LANGUAGE[langKey] || FALLBACK_DEFAULT_TITLE;
        }
        return FALLBACK_DEFAULT_TITLE;
    }

    /**
     * Maps a raw Mongoose conversation document to a simplified `ConversationMetadata` object.
     * Generates a title if a custom title is not set.
     * @param {IConversation & { _id: Types.ObjectId }} conv - The Mongoose conversation document.
     * @param {string} [language] - The language to use for title generation.
     * @returns {ConversationMetadata} The mapped conversation metadata.
     */
    private mapConversationToMetadata(
        conv: (IConversation & { _id: Types.ObjectId }) | (Omit<IConversation, keyof Document> & { _id: Types.ObjectId }),
        language?: string
    ): ConversationMetadata {
        // Use customTitle if available, otherwise generate from messages
        const title = conv.customTitle || this.generateTitleFromMessages(conv.messages || [], language);
        return {
            id: conv._id.toString(),
            title: title,
            lastActivity: conv.lastActivity,
            isPinned: conv.isPinned || false, // Default to false if not set
        };
    }


    /**
     * Retrieves a list of conversation metadata for a specific user, sorted by pinned status and last activity.
     * @param {string} userId - The ID of the user.
     * @param {number} [limit=DEFAULT_CONVERSATION_LIMIT] - The maximum number of conversations to return.
     * @param {string} [language] - The language for generating default titles if needed.
     * @returns {Promise<ConversationMetadata[]>} A Promise that resolves to an array of `ConversationMetadata`.
     *                                          Returns an empty array if an error occurs.
     */
    async getConversationListForUser(
        userId: string,
        limit: number = DEFAULT_CONVERSATION_LIMIT,
        language?: string
    ): Promise<ConversationMetadata[]> {
        const logContext = `${LOG_PREFIX} [List User: ${userId}, Limit: ${limit}, Lang: ${language || 'N/A'}]`;
        
        try {
            const conversations = await this.model.find({ userId })
                .sort({ isPinned: -1, lastActivity: -1 }) // Pinned conversations first, then by latest activity
                .limit(limit)
                .select('_id messages lastActivity customTitle isPinned') // Select relevant fields
                .lean() // Return plain JavaScript objects, not Mongoose documents
                .exec();

            const metadataList: ConversationMetadata[] = conversations.map(conv =>
                // Cast to ensure proper type for mapConversationToMetadata
                this.mapConversationToMetadata(conv as (Omit<IConversation, keyof Document> & { _id: Types.ObjectId }), language)
            );

            
            return metadataList;
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            return []; // Return empty array on error for robustness
        }
    }

    /**
     * Retrieves the most recent conversation for a user, or creates a new one if none exists.
     * Updates the `lastActivity` timestamp of the retrieved conversation.
     * @param {string} userId - The ID of the authenticated user.
     * @param {string} [language] - The language for generating a default title if a new conversation is created.
     * @returns {Promise<NewConversationResult>} A Promise that resolves with the `NewConversationResult`,
     *                                          including conversation ID, history, title, and other metadata.
     * @throws {Error} If a database interaction problem occurs.
     */
    async getLatestOrCreateConversation(
        userId: string,
        language?: string
    ): Promise<NewConversationResult> {
        const logContext = `${LOG_PREFIX} [GetOrCreate User: ${userId}, Lang: ${language || 'N/A'}]`;
        
        try {
            const latestConversation = await this.model.findOne({ userId })
                .sort({ lastActivity: -1 }) // Sort to get the most recent one
                .exec();

            if (latestConversation) {
                
                latestConversation.lastActivity = new Date(); // Update timestamp
                await latestConversation.save(); // Save changes

                return {
                    conversationId: latestConversation._id.toString(),
                    history: latestConversation.messages || [],
                    // Title relies on customTitle or generated from messages
                    title: latestConversation.customTitle || this.generateTitleFromMessages(latestConversation.messages || [], language),
                    lastActivity: latestConversation.lastActivity,
                    isPinned: latestConversation.isPinned || false,
                };
            } else {
                
                // If no conversation found, create a brand new one
                return this.createNewConversation(userId, language);
            }
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            throw new Error(`Database error getting/creating conversation: ${errorMessage}`);
        }
    }

    /**
     * Retrieves the chat history for a specific conversation belonging to a user.
     * @param {string} conversationId - The ID of the conversation.
     * @param {string} userId - The ID of the user (for authorization).
     * @param {number} [limit] - Optional: Limits the number of most recent messages to retrieve.
     * @returns {Promise<ChatHistoryItem[] | null>} A Promise resolving to an array of `ChatHistoryItem`
     *                                              or `null` if the conversation is not found or not authorized.
     * @throws {Error} If a database interaction problem occurs (excluding Mongoose CastError, which returns null).
     */
    async getConversationHistory(
        conversationId: string,
        userId: string,
        limit?: number
    ): Promise<ChatHistoryItem[] | null> {
        const logContext = `${LOG_PREFIX} [GetHistory Conv: ${conversationId}, User: ${userId}, Limit: ${limit ?? 'None'}]`;
        // Validate conversationId format early to prevent Mongoose CastError for invalid IDs
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return null; // Return null for invalid ID format
        }
        try {
            // Use $slice to retrieve only the last 'limit' messages if limit is provided
            const projection = limit && limit > 0 ? { messages: { $slice: -limit } } : { messages: 1 };

            const conversation = await this.model
                .findOne({ _id: conversationId, userId })
                .select(projection)
                .lean<{ _id: Types.ObjectId; messages?: ChatHistoryItem[] }>() // Explicitly define lean result type
                .exec();

            if (conversation) {
                return conversation.messages || []; // Return messages array, or empty array if null/undefined
            }
            
            return null; // Return null if conversation not found or not owned by user

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            // Treat Mongoose CastError specifically as "not found" or invalid ID
            if (error instanceof MongooseError.CastError) {
                
                return null; // Consider CastError as "not found"
            }
            // Re-throw other database errors for higher-level handling
            throw new Error(`Database error getting conversation history: ${errorMessage}`);
        }
    }

    /**
     * Updates the entire message history for a specific conversation belonging to a user.
     * Ensures all messages have timestamps and implicitly updates `lastActivity` via Mongoose hooks.
     * @param {string} conversationId - The ID of the conversation to update.
     * @param {string} userId - The ID of the user (for authorization).
     * @param {ChatHistoryItem[]} newHistory - The new array of `ChatHistoryItem` to replace the existing history.
     * @returns {Promise<boolean>} A Promise that resolves to `true` if the update was successful, `false` otherwise.
     * @throws {Error} If a general database interaction problem occurs (excluding Mongoose CastError, which returns false).
     */
    async updateConversationHistory(
        conversationId: string,
        userId: string,
        newHistory: ChatHistoryItem[]
    ): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [UpdateHistory Conv: ${conversationId}, User: ${userId}]`;
        // Validate conversationId format
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return false;
        }

        // Ensure all messages have a timestamp, creating one if missing.
        const historyWithTimestamps = newHistory.map(item => ({
            ...item,
            timestamp: item.timestamp || new Date()
        }));
        

        try {
            // `lastActivity` will be updated by a pre-save/update Mongoose hook.
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: historyWithTimestamps } }
            ).exec();

            if (result.matchedCount > 0) {
                
                return true; // Return true if at least one document was matched (and potentially modified)
            } else {
                
                return false;
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            // Handle CastError specifically as a non-fatal error (e.g., malformed ID)
            if (error instanceof MongooseError.CastError) {
                
                return false;
            }
            // Re-throw other database errors
            throw new Error(`Database error updating conversation history: ${errorMessage}`);
        }
    }

    /**
     * Creates a new, empty conversation explicitly for the given user.
     * Initializes the conversation with a localized default title.
     * @param {string} userId - The ID of the user.
     * @param {string} [language] - The language for generating the default title.
     * @returns {Promise<NewConversationResult>} A Promise that resolves with the details of the newly created conversation.
     * @throws {Error} If a database interaction problem occurs.
     */
    async createNewConversation(
        userId: string,
        language?: string
    ): Promise<NewConversationResult> {
        const logContext = `${LOG_PREFIX} [CreateNew User: ${userId}, Lang: ${language || 'N/A'}]`;
        
        try {
            const initialTitle = this.getLocalizedDefaultTitle(language);
            

            const newConversationDoc = await this.model.create({
                userId: userId,
                messages: [],
                customTitle: initialTitle, // Set customTitle with the language-specific title
                isPinned: false, // Default to not pinned
                lastActivity: new Date() // Set initial lastActivity
            });

            // Re-fetch the saved document to ensure all default Mongoose fields are populated (like `lastActivity` if hook is used)
            const savedConversation = await this.model.findById(newConversationDoc._id).lean().exec();
            if (!savedConversation) {
                const errorMsg = `CRITICAL: Failed to retrieve newly created conversation ${newConversationDoc._id}`;
                
                throw new Error(errorMsg);
            }
            

            return {
                conversationId: savedConversation._id.toString(),
                history: [], // History is empty for new conversations
                title: savedConversation.customTitle || initialTitle, // Ensure the title is from customTitle if available
                lastActivity: savedConversation.lastActivity,
                isPinned: savedConversation.isPinned || false,
            };
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            throw new Error(`Database error creating new conversation: ${errorMessage}`);
        }
    }

    /**
     * Deletes a specific conversation belonging to a user.
     * @param {string} conversationId - The ID of the conversation to delete.
     * @param {string} userId - The ID of the user (for authorization).
     * @returns {Promise<boolean>} A Promise that resolves to `true` if deletion was successful, `false` otherwise.
     */
    async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [Delete Conv: ${conversationId}, User: ${userId}]`;
        // Validate conversationId format
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return false;
        }
        try {
            const result = await this.model.deleteOne({ _id: conversationId, userId: userId }).exec();
            if (result.deletedCount === 1) {
                
                return true;
            } else {
                
                return false;
            }
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            return false; // Return false on error for safety
        }
    }

    /**
     * Clears all messages from a specific conversation belonging to a user.
     * The conversation record itself is retained, but its history is reset to empty.
     * @param {string} conversationId - The ID of the conversation to clear messages from.
     * @param {string} userId - The ID of the user (for authorization).
     * @returns {Promise<boolean>} A Promise that resolves to `true` if messages were cleared successfully, `false` otherwise.
     */
    async clearConversationMessages(conversationId: string, userId: string): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [ClearMessages Conv: ${conversationId}, User: ${userId}]`;
        // Validate conversationId format
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return false;
        }
        try {
            // `lastActivity` will be updated by a pre-save/update Mongoose hook.
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: [] } } // Set messages array to empty
            ).exec();

            if (result.matchedCount > 0) {
                
                return true;
            } else {
                
                return false;
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            // Handle CastError specifically
            if (error instanceof MongooseError.CastError) {
                
                return false;
            }
            return false; // Return false on other DB errors
        }
    }

    /**
     * Renames a specific conversation belonging to a user.
     * The new title is trimmed and truncated if it exceeds `MAX_CUSTOM_TITLE_LENGTH`.
     * @param {string} conversationId - The ID of the conversation to rename.
     * @param {string} userId - The ID of the user (for authorization).
     * @param {string} newTitle - The new title for the conversation.
     * @returns {Promise<RenameResult>} A Promise resolving to a `RenameResult` object,
     *                                 indicating success, the updated title, and the conversation ID.
     */
    async renameConversation(
        conversationId: string,
        userId: string,
        newTitle: string
    ): Promise<RenameResult> {
        const logContext = `${LOG_PREFIX} [Rename Conv: ${conversationId}, User: ${userId}]`;
        

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return { success: false, conversationId, errorMessage: "Invalid conversation ID format." };
        }

        const trimmedTitle = newTitle.trim();
        // Truncate after trimming if it exceeds max custom length
        const finalTitle = trimmedTitle.substring(0, Math.min(trimmedTitle.length, MAX_CUSTOM_TITLE_LENGTH));

        if (finalTitle.length === 0) {
            
            // You might choose to set customTitle to undefined/null here to revert to auto-generated title.
            // For now, returning false as per original logic for empty title.
            return { success: false, conversationId, errorMessage: "New title cannot be empty." };
        }

        try {
            // `lastActivity` will be updated by a pre-save/update Mongoose hook.
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { customTitle: finalTitle, lastActivity: new Date() } }
            ).exec();

            if (result.matchedCount === 0) {
                
                return { success: false, conversationId, errorMessage: "Conversation not found or not authorized." };
            }

            const wasModified = result.modifiedCount > 0;
            

            return { success: true, updatedTitle: finalTitle, conversationId };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            return { success: false, conversationId, updatedTitle: newTitle, errorMessage: `Database error renaming conversation: ${errorMessage}` };
        }
    }

    /**
     * Pins or unpins a conversation for a user.
     * @param {string} conversationId - The ID of the conversation.
     * @param {string} userId - The ID of the user (for authorization).
     * @param {boolean} pinStatus - `true` to pin, `false` to unpin.
     * @returns {Promise<boolean>} A Promise that resolves to `true` if the pin status was updated successfully, `false` otherwise.
     */
    async pinConversation(
        conversationId: string,
        userId: string,
        pinStatus: boolean
    ): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [Pin Conv: ${conversationId}, User: ${userId}, Status: ${pinStatus}]`;
        

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return false;
        }

        try {
            // `lastActivity` will be updated by a pre-save/update Mongoose hook.
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { isPinned: pinStatus, lastActivity: new Date() } } // Update lastActivity too
            ).exec();

            if (result.matchedCount === 0) {
                
                return false;
            }
            
            return true;
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            return false;
        }
    }

    /**
     * Finds a user's message within a conversation by its UUID and prepares the history
     * for a new bot response. This function DOES NOT save to the DB; it only prepares data.
     * It also performs a consistency check to ensure the message to edit is the *last* user message.
     *
     * @param {string} userId - The ID of the user.
     * @param {string} conversationId - The ID of the conversation.
     * @param {string} messageIdToEdit - The UUID of the user message to be edited (from frontend).
     * @param {string} newText - The new content for the user message.
     * @returns {Promise<UpdateUserMessageResult | null>} A Promise resolving to an `UpdateUserMessageResult`
     *                                                  or `null` if a critical database error occurs (e.g., beyond CastError).
     */
    public async updateUserMessageAndPrepareHistory(
        userId: string,
        conversationId: string,
        messageIdToEdit: string, // UUID from frontend
        newText: string
    ): Promise<UpdateUserMessageResult | null> {
        const logContext = `${LOG_PREFIX} [UpdateUserMsgPrepareHist User: ${userId}, Conv: ${conversationId}, MsgToEdit: ${messageIdToEdit}]`;
        

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            
            return {
                originalConversationFound: false,
                messageFoundAndIsLastUserMessage: false,
                editedUserMessage: undefined, // Ensure these are undefined if not found
                historyForNewBotResponse: undefined,
            };
        }

        try {
            const conversation = await this.model.findOne({ _id: conversationId, userId: userId });

            if (!conversation) {
                
                return {
                    originalConversationFound: false,
                    messageFoundAndIsLastUserMessage: false,
                    editedUserMessage: undefined,
                    historyForNewBotResponse: undefined,
                };
            }

            const messages = conversation.messages || [];
            // Find the message to edit based on its UUID (frontend ID) and ensure it's a 'user' role message.
            // Assumes ChatHistoryItem schema has a `uuid` field.
            const messageToEditIndex = messages.findIndex(msg => (msg as any).uuid === messageIdToEdit && msg.role === 'user');

            if (messageToEditIndex === -1) {
                
                return {
                    originalConversationFound: true, // Conversation was found
                    messageFoundAndIsLastUserMessage: false, // But target message not found/invalid
                    editedUserMessage: undefined,
                    historyForNewBotResponse: undefined,
                };
            }

            // Consistency check: Verify that this is indeed the *last* user message in the history.
            let lastUserMessageActualIndex = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === 'user') {
                    lastUserMessageActualIndex = i;
                    break;
                }
            }

            if (messageToEditIndex !== lastUserMessageActualIndex) {
                
                return {
                    originalConversationFound: true,
                    messageFoundAndIsLastUserMessage: false, // Message found but not the last user one
                    editedUserMessage: undefined,
                    historyForNewBotResponse: undefined,
                };
            }

            // 1. Create the edited user message object
            const originalUserMessage = messages[messageToEditIndex];
            const editedUserMessage: ChatHistoryItem = {
                role: 'user', // Ensure role is 'user'
                parts: [{ text: newText.trim() }], // Trim the new text content
                timestamp: new Date(), // Update timestamp to now for the edited message
                uuid: (originalUserMessage as any).uuid, // Preserve the original UUID
            };
            

            // 2. Create the history array to send to the AI
            // This includes all messages *before* the message being edited, followed by the edited message itself.
            const historyForNewBotResponse = messages.slice(0, messageToEditIndex);
            historyForNewBotResponse.push(editedUserMessage);

            

            return {
                editedUserMessage,
                historyForNewBotResponse,
                originalConversationFound: true,
                messageFoundAndIsLastUserMessage: true,
            };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            
            // Handle Mongoose CastError specifically (e.g., if conversationId seems valid but is malformed)
            if (error instanceof MongooseError.CastError) {
                
                return {
                    originalConversationFound: false, // Treat CastError as conversation not found for this context
                    messageFoundAndIsLastUserMessage: false,
                    editedUserMessage: undefined,
                    historyForNewBotResponse: undefined,
                };
            }
            // Re-throw other database errors for higher-level handling
            throw new Error(`Database error during message update and history preparation: ${errorMessage}`);
        }
    }

    /**
     * Generates a conversational title based on the first user or model message.
     * Truncates the title if it exceeds the maximum length.
     * @param {ChatHistoryItem[]} messages - An array of messages in the conversation.
     * @param {string} [language] - The language to use for the default title if no messages are found.
     * @returns {string} The generated (or default) title.
     */
    private generateTitleFromMessages(messages: ChatHistoryItem[], language?: string): string {
        let title = this.getLocalizedDefaultTitle(language); // Start with localized default title

        // Attempt to find the first user message's text
        const firstUserMessageText = messages
            .find(msg => msg.role === 'user' && msg.parts && msg.parts.length > 0 && typeof msg.parts[0].text === 'string')?.parts[0].text?.trim();

        // If no user message, attempt to find the first model message's text
        const firstModelMessageText = messages
            .find(msg => msg.role === 'model' && msg.parts && msg.parts.length > 0 && typeof msg.parts[0].text === 'string')?.parts[0].text?.trim();

        if (firstUserMessageText && firstUserMessageText.length > 0) {
            title = firstUserMessageText;
        } else if (firstModelMessageText && firstModelMessageText.length > 0) {
            title = firstModelMessageText;
        }

        // Truncate the title if it exceeds the maximum allowed length
        if (title.length > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
        }
        return title;
    }
}