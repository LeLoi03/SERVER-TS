// src/chatbot/services/conversationHistory.service.ts
import mongoose, { Types, Error as MongooseError, Document } from 'mongoose';
import { container } from 'tsyringe';
import ConversationModel, { IConversation } from '../models/conversation.model';
import { ChatHistoryItem, RenameResult, NewConversationResult } from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { CryptoService } from './crypto.service';

const LOG_PREFIX = "[HistoryService]";
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_TITLE_LENGTH = 50;
const MAX_CUSTOM_TITLE_LENGTH = 120;
const TRUNCATE_SUFFIX = '...';

const DEFAULT_TITLES_BY_LANGUAGE: { [key: string]: string } = {
    en: "New Chat",
    vi: "Cuộc trò chuyện mới",
    zh: "新对话",
    de: "Neuer Chat",
    fr: "Nouvelle discussion",
    es: "Nuevo chat",
    ru: "Новый чат",
    ja: "新しいチャット",
    ko: "새 채팅",
    ar: "دردشة جديدة",
};
const FALLBACK_DEFAULT_TITLE = "New Chat";

export interface ConversationMetadata {
    id: string;
    title: string;
    lastActivity: Date;
    isPinned: boolean;
}

export interface UpdateUserMessageResult {
    editedUserMessage?: ChatHistoryItem;
    historyForNewBotResponse?: ChatHistoryItem[];
    originalConversationFound: boolean;
    messageFoundAndIsLastUserMessage: boolean;
}

/**
 * Service responsible for managing user conversation history stored in MongoDB.
 * Handles application-level encryption and decryption of message content.
 */
export class ConversationHistoryService {
    private readonly model: mongoose.Model<IConversation>;
    private readonly cryptoService: CryptoService;

    constructor() {
        this.model = ConversationModel;
        this.cryptoService = container.resolve(CryptoService);
    }

    // =================================================================
    // PRIVATE HELPER METHODS FOR ENCRYPTION/DECRYPTION
    // =================================================================

    /**
     * Encrypts the text content of message parts for an array of history items.
     * @param history The array of ChatHistoryItem in plain text.
     * @param userId The user's ID, used to derive the encryption key.
     * @returns A new array of ChatHistoryItem with encrypted text content.
     */
    private _encryptHistory(history: ChatHistoryItem[], userId: string): ChatHistoryItem[] {
        return history.map(item => {
            if ((item.role === 'user' || item.role === 'model') && item.parts) {
                const encryptedParts = item.parts.map(part => {
                    if (part.text && typeof part.text === 'string') {
                        return { ...part, text: this.cryptoService.encrypt(part.text, userId) };
                    }
                    return part;
                });
                return { ...item, parts: encryptedParts };
            }
            return item;
        });
    }

    /**
     * Decrypts the text content of message parts for an array of history items.
     * @param history The array of ChatHistoryItem with encrypted text.
     * @param userId The user's ID, used to derive the decryption key.
     * @returns A new array of ChatHistoryItem with decrypted text content.
     */
    private _decryptHistory(history: ChatHistoryItem[], userId: string): ChatHistoryItem[] {
        return history.map(item => {
            if ((item.role === 'user' || item.role === 'model') && item.parts) {
                const decryptedParts = item.parts.map(part => {
                    if (part.text && typeof part.text === 'string') {
                        const decryptedText = this.cryptoService.decrypt(part.text, userId);
                        return { ...part, text: decryptedText ?? '[Nội dung không thể giải mã]' };
                    }
                    return part;
                });
                return { ...item, parts: decryptedParts };
            }
            return item;
        });
    }

    // =================================================================
    // CORE PUBLIC METHODS (MODIFIED FOR ENCRYPTION)
    // =================================================================

    private getLocalizedDefaultTitle(language?: string): string {
        if (language) {
            const langKey = language.toLowerCase().slice(0, 2);
            return DEFAULT_TITLES_BY_LANGUAGE[langKey] || FALLBACK_DEFAULT_TITLE;
        }
        return FALLBACK_DEFAULT_TITLE;
    }

    private mapConversationToMetadata(
        conv: (IConversation & { _id: Types.ObjectId }) | (Omit<IConversation, keyof Document> & { _id: Types.ObjectId }),
        language?: string
    ): ConversationMetadata {
        // This function now receives DECRYPTED messages, so title generation works correctly.
        const title = conv.customTitle || this.generateTitleFromMessages(conv.messages || [], language);
        return {
            id: conv._id.toString(),
            title: title,
            lastActivity: conv.lastActivity,
            isPinned: conv.isPinned || false,
        };
    }

    async getConversationListForUser(
        userId: string,
        limit: number = DEFAULT_CONVERSATION_LIMIT,
        language?: string
    ): Promise<ConversationMetadata[]> {
        try {
            const conversations = await this.model.find({ userId })
                .sort({ isPinned: -1, lastActivity: -1 })
                .limit(limit)
                .select('_id messages lastActivity customTitle isPinned')
                .lean()
                .exec();

            // Decrypt messages before mapping to metadata to ensure title generation works.
            const metadataList: ConversationMetadata[] = conversations.map(conv => {
                const decryptedMessages = this._decryptHistory(conv.messages || [], userId);
                const convWithDecryptedData = { ...conv, messages: decryptedMessages };
                return this.mapConversationToMetadata(convWithDecryptedData, language);
            });

            return metadataList;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [List User: ${userId}] Error: ${errorMessage}`);
            return [];
        }
    }

    async getLatestOrCreateConversation(
        userId: string,
        language?: string
    ): Promise<NewConversationResult> {
        try {
            const latestConversation = await this.model.findOne({ userId })
                .sort({ lastActivity: -1 })
                .exec();

            if (latestConversation) {
                latestConversation.lastActivity = new Date();
                await latestConversation.save();

                // Decrypt history before returning it to the application.
                const decryptedHistory = this._decryptHistory(latestConversation.messages || [], userId);

                return {
                    conversationId: latestConversation._id.toString(),
                    history: decryptedHistory,
                    title: latestConversation.customTitle || this.generateTitleFromMessages(decryptedHistory, language),
                    lastActivity: latestConversation.lastActivity,
                    isPinned: latestConversation.isPinned || false,
                };
            } else {
                return this.createNewConversation(userId, language);
            }
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [GetOrCreate User: ${userId}] Error: ${errorMessage}`);
            throw new Error(`Database error getting/creating conversation: ${errorMessage}`);
        }
    }

    async getConversationHistory(
        conversationId: string,
        userId: string,
        limit?: number
    ): Promise<ChatHistoryItem[] | null> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return null;
        }
        try {
            const projection = limit && limit > 0 ? { messages: { $slice: -limit } } : { messages: 1 };
            const conversation = await this.model
                .findOne({ _id: conversationId, userId })
                .select(projection)
                .lean<{ _id: Types.ObjectId; messages?: ChatHistoryItem[] }>()
                .exec();

            if (conversation && conversation.messages) {
                // Decrypt messages after fetching from DB.
                return this._decryptHistory(conversation.messages, userId);
            }
            return null;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            if (error instanceof MongooseError.CastError) {
                return null;
            }
            console.error(`${LOG_PREFIX} [GetHistory Conv: ${conversationId}] Error: ${errorMessage}`);
            throw new Error(`Database error getting conversation history: ${errorMessage}`);
        }
    }

    async updateConversationHistory(
        conversationId: string,
        userId: string,
        newHistory: ChatHistoryItem[]
    ): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return false;
        }

        try {
            // Encrypt history before saving to DB.
            const encryptedHistory = this._encryptHistory(newHistory, userId);

            const historyWithTimestamps = encryptedHistory.map(item => ({
                ...item,
                timestamp: item.timestamp || new Date()
            }));

            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: historyWithTimestamps } }
            ).exec();

            return result.matchedCount > 0;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            if (error instanceof MongooseError.CastError) {
                return false;
            }
            console.error(`${LOG_PREFIX} [UpdateHistory Conv: ${conversationId}] Error: ${errorMessage}`);
            throw new Error(`Database error updating conversation history: ${errorMessage}`);
        }
    }

    async createNewConversation(
        userId: string,
        language?: string
    ): Promise<NewConversationResult> {
        // No encryption needed here as messages array is empty.
        try {
            const initialTitle = this.getLocalizedDefaultTitle(language);
            const newConversationDoc = await this.model.create({
                userId: userId,
                messages: [],
                customTitle: initialTitle,
                isPinned: false,
                lastActivity: new Date()
            });

            const savedConversation = await this.model.findById(newConversationDoc._id).lean().exec();
            if (!savedConversation) {
                throw new Error(`CRITICAL: Failed to retrieve newly created conversation ${newConversationDoc._id}`);
            }

            return {
                conversationId: savedConversation._id.toString(),
                history: [],
                title: savedConversation.customTitle || initialTitle,
                lastActivity: savedConversation.lastActivity,
                isPinned: savedConversation.isPinned || false,
            };
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [CreateNew User: ${userId}] Error: ${errorMessage}`);
            throw new Error(`Database error creating new conversation: ${errorMessage}`);
        }
    }

    public async updateUserMessageAndPrepareHistory(
        userId: string,
        conversationId: string,
        messageIdToEdit: string,
        newText: string
    ): Promise<UpdateUserMessageResult | null> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return { originalConversationFound: false, messageFoundAndIsLastUserMessage: false };
        }

        try {
            const conversation = await this.model.findOne({ _id: conversationId, userId: userId });
            if (!conversation) {
                return { originalConversationFound: false, messageFoundAndIsLastUserMessage: false };
            }

            // Decrypt the entire history to work with plain text.
            const decryptedMessages = this._decryptHistory(conversation.messages || [], userId);

            const messageToEditIndex = decryptedMessages.findIndex(msg => (msg as any).uuid === messageIdToEdit && msg.role === 'user');
            if (messageToEditIndex === -1) {
                return { originalConversationFound: true, messageFoundAndIsLastUserMessage: false };
            }

            let lastUserMessageActualIndex = -1;
            for (let i = decryptedMessages.length - 1; i >= 0; i--) {
                if (decryptedMessages[i].role === 'user') {
                    lastUserMessageActualIndex = i;
                    break;
                }
            }

            if (messageToEditIndex !== lastUserMessageActualIndex) {
                return { originalConversationFound: true, messageFoundAndIsLastUserMessage: false };
            }

            const originalUserMessage = decryptedMessages[messageToEditIndex];
            const editedUserMessage: ChatHistoryItem = {
                role: 'user',
                parts: [{ text: newText.trim() }],
                timestamp: new Date(),
                uuid: (originalUserMessage as any).uuid,
            };

            // The history prepared for the AI handler should be in plain text.
            const historyForNewBotResponse = decryptedMessages.slice(0, messageToEditIndex);
            historyForNewBotResponse.push(editedUserMessage);

            // The return value contains plain text. Encryption will happen later
            // when `updateConversationHistory` is called with the final, complete history.
            return {
                editedUserMessage,
                historyForNewBotResponse,
                originalConversationFound: true,
                messageFoundAndIsLastUserMessage: true,
            };
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            if (error instanceof MongooseError.CastError) {
                return { originalConversationFound: false, messageFoundAndIsLastUserMessage: false };
            }
            console.error(`${LOG_PREFIX} [UpdateUserMsgPrepareHist User: ${userId}] Error: ${errorMessage}`);
            throw new Error(`Database error during message update and history preparation: ${errorMessage}`);
        }
    }

    // =================================================================
    // UNMODIFIED PUBLIC METHODS (No direct interaction with message content)
    // =================================================================

    async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return false;
        }
        try {
            const result = await this.model.deleteOne({ _id: conversationId, userId: userId }).exec();
            return result.deletedCount === 1;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [Delete Conv: ${conversationId}] Error: ${errorMessage}`);
            return false;
        }
    }

    async clearConversationMessages(conversationId: string, userId: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return false;
        }
        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: [] } }
            ).exec();
            return result.matchedCount > 0;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            if (error instanceof MongooseError.CastError) {
                return false;
            }
            console.error(`${LOG_PREFIX} [ClearMessages Conv: ${conversationId}] Error: ${errorMessage}`);
            return false;
        }
    }

    async renameConversation(
        conversationId: string,
        userId: string,
        newTitle: string
    ): Promise<RenameResult> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return { success: false, conversationId, errorMessage: "Invalid conversation ID format." };
        }
        const trimmedTitle = newTitle.trim();
        const finalTitle = trimmedTitle.substring(0, Math.min(trimmedTitle.length, MAX_CUSTOM_TITLE_LENGTH));
        if (finalTitle.length === 0) {
            return { success: false, conversationId, errorMessage: "New title cannot be empty." };
        }
        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { customTitle: finalTitle, lastActivity: new Date() } }
            ).exec();
            if (result.matchedCount === 0) {
                return { success: false, conversationId, errorMessage: "Conversation not found or not authorized." };
            }
            return { success: true, updatedTitle: finalTitle, conversationId };
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [Rename Conv: ${conversationId}] Error: ${errorMessage}`);
            return { success: false, conversationId, updatedTitle: newTitle, errorMessage: `Database error renaming conversation: ${errorMessage}` };
        }
    }

    async pinConversation(
        conversationId: string,
        userId: string,
        pinStatus: boolean
    ): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            return false;
        }
        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { isPinned: pinStatus, lastActivity: new Date() } }
            ).exec();
            return result.matchedCount > 0;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            console.error(`${LOG_PREFIX} [Pin Conv: ${conversationId}] Error: ${errorMessage}`);
            return false;
        }
    }

    private generateTitleFromMessages(messages: ChatHistoryItem[], language?: string): string {
        // This function now correctly receives decrypted messages.
        let title = this.getLocalizedDefaultTitle(language);
        const firstUserMessageText = messages
            .find(msg => msg.role === 'user' && msg.parts?.[0]?.text)?.parts[0].text?.trim();
        const firstModelMessageText = messages
            .find(msg => msg.role === 'model' && msg.parts?.[0]?.text)?.parts[0].text?.trim();
        if (firstUserMessageText) {
            title = firstUserMessageText;
        } else if (firstModelMessageText) {
            title = firstModelMessageText;
        }
        if (title.length > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
        }
        return title;
    }
}