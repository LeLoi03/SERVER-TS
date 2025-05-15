// src/chatbot/services/conversationHistory.service.ts
import mongoose, { Types, Error as MongooseError } from 'mongoose';
import ConversationModel, { IConversation } from '../models/conversation.model';
import { HistoryItem, RenameResult, NewConversationResult } from '../shared/types';
import logToFile from '../../utils/logger'; // Đảm bảo đường dẫn đúng

const LOG_PREFIX = "[HistoryService]";
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_TITLE_LENGTH = 50; // Cho tiêu đề tự động
const MAX_CUSTOM_TITLE_LENGTH = 120; // Cho tiêu đề người dùng đặt
const TRUNCATE_SUFFIX = '...';

// Define default titles based on language
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
    fa: "چت جدید",                  // Persian (Farsi)
};
const FALLBACK_DEFAULT_TITLE = "New Chat"; // Fallback if language not found or not provided


/**
 * Định nghĩa kiểu dữ liệu cho metadata của cuộc trò chuyện.
 */
export interface ConversationMetadata {
    id: string;
    title: string;
    lastActivity: Date;
    isPinned: boolean; // Thêm isPinned
    // snippet?: string; // Có thể thêm một đoạn trích từ tin nhắn khớp khi tìm kiếm
}



/**
 * Service quản lý lịch sử cuộc trò chuyện của người dùng.
 */
export class ConversationHistoryService {
    private readonly model: mongoose.Model<IConversation>;

    constructor() {
        this.model = ConversationModel;
        logToFile(`${LOG_PREFIX} Initialized.`);
    }

    private getLocalizedDefaultTitle(language?: string): string {
        if (language) {
            const langKey = language.toLowerCase().slice(0, 2); // e.g., 'en' from 'en-US'
            return DEFAULT_TITLES_BY_LANGUAGE[langKey] || FALLBACK_DEFAULT_TITLE;
        }
        return FALLBACK_DEFAULT_TITLE;
    }

     private mapConversationToMetadata(
        conv: (IConversation & { _id: Types.ObjectId }) | (Omit<IConversation, keyof Document> & { _id: Types.ObjectId }),
        language?: string // << ADDED language parameter
    ): ConversationMetadata {
        const title = conv.customTitle || this.generateTitleFromMessages(conv.messages || [], language); // << PASS language
        return {
            id: conv._id.toString(),
            title: title,
            lastActivity: conv.lastActivity,
            isPinned: conv.isPinned || false,
        };
    }


    /**
     * Lấy danh sách metadata cuộc trò chuyện cho một người dùng cụ thể.
     * @param userId - ID của người dùng.
     * @param limit - Số lượng cuộc trò chuyện tối đa trả về. Mặc định là 20.
     * @returns Promise trả về một mảng ConversationMetadata. Trả về mảng rỗng nếu có lỗi.
     */
    async getConversationListForUser(
        userId: string,
        limit: number = DEFAULT_CONVERSATION_LIMIT,
        language?: string // << ADDED language parameter
    ): Promise<ConversationMetadata[]> {
        const logContext = `${LOG_PREFIX} [List User: ${userId}, Limit: ${limit}, Lang: ${language || 'N/A'}]`;
        logToFile(`${logContext} Fetching conversation list.`);
        try {
            const conversations = await this.model.find({ userId })
                .sort({ isPinned: -1, lastActivity: -1 })
                .limit(limit)
                .select('_id messages lastActivity customTitle isPinned')
                .lean()
                .exec();

            const metadataList: ConversationMetadata[] = conversations.map(conv =>
                this.mapConversationToMetadata(conv as (Omit<IConversation, keyof Document> & { _id: Types.ObjectId }), language) // << PASS language
            );

            logToFile(`${logContext} Found ${metadataList.length} conversations.`);
            return metadataList;
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${LOG_PREFIX} Error fetching conversation list for user ${userId}: ${errorMsg}`);
            return [];
        }
    }

    /**
    * Lấy cuộc trò chuyện gần đây nhất cho người dùng hoặc tạo mới nếu không tồn tại.
    * Cập nhật dấu thời gian lastActivity của cuộc trò chuyện được lấy.
    * @param userId - ID của người dùng đã xác thực.
    * @returns Promise trả về ID cuộc trò chuyện và lịch sử tin nhắn.
    * @throws Error nếu có vấn đề tương tác cơ sở dữ liệu.
    */
     async getLatestOrCreateConversation(
        userId: string,
        language?: string // << ADDED language parameter
    ): Promise<NewConversationResult> { // << MODIFIED: Return type to NewConversationResult for consistency
        const logContext = `${LOG_PREFIX} [GetOrCreate User: ${userId}, Lang: ${language || 'N/A'}]`;
        logToFile(`${logContext} Attempting to find latest or create new conversation.`);
        try {
            const latestConversation = await this.model.findOne({ userId })
                .sort({ lastActivity: -1 })
                .exec();

            if (latestConversation) {
                logToFile(`${logContext} Found latest conversation: ${latestConversation._id}. Updating lastActivity.`);
                latestConversation.lastActivity = new Date();
                await latestConversation.save();
                return {
                    conversationId: latestConversation._id.toString(),
                    history: latestConversation.messages || [],
                    // For existing conv, title relies on customTitle or generated from messages
                    title: latestConversation.customTitle || this.generateTitleFromMessages(latestConversation.messages || [], language),
                    lastActivity: latestConversation.lastActivity,
                    isPinned: latestConversation.isPinned || false,
                };
            } else {
                logToFile(`${logContext} No existing conversation found. Creating new.`);
                return this.createNewConversation(userId, language); // << PASS language
            }
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error: ${errorMsg}`);
            throw new Error(`Database error getting/creating conversation: ${errorMsg}`);
        }
    }

    /**
     * Lấy lịch sử của một cuộc trò chuyện cụ thể cho người dùng đã cho.
     * @param conversationId - ID của cuộc trò chuyện.
     * @param userId - ID của người dùng (để xác thực quyền).
     * @param limit - Tùy chọn: giới hạn số lượng tin nhắn lấy về (gần đây nhất).
     * @returns Promise trả về mảng lịch sử hoặc null nếu không tìm thấy/không có quyền.
     * @throws Error nếu có vấn đề tương tác cơ sở dữ liệu (ngoại trừ CastError).
     */
    async getConversationHistory(
        conversationId: string,
        userId: string,
        limit?: number
    ): Promise<HistoryItem[] | null> {
        const logContext = `${LOG_PREFIX} [GetHistory Conv: ${conversationId}, User: ${userId}, Limit: ${limit ?? 'None'}]`;
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format.`);
            return null;
        }
        try {
            const projection = limit && limit > 0 ? { messages: { $slice: -limit } } : { messages: 1 };
            // Ép kiểu kết quả của lean() thành một object có cấu trúc mong đợi
            const conversation = await this.model
                .findOne({ _id: conversationId, userId })
                .select(projection)
                .lean<{ _id: Types.ObjectId; messages?: HistoryItem[] }>() //  <-- Dùng kiểu cụ thể hơn
                .exec();
            if (conversation) {
                return conversation.messages || [];
            }
            return null;

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error getting history: ${errorMsg}`);
            // Xử lý CastError một cách nhẹ nhàng hơn nếu nó vẫn xảy ra sau khi kiểm tra isValid
            if (error instanceof MongooseError.CastError) {
                logToFile(`${logContext} CastError encountered despite validation.`);
                return null; // Coi CastError như "không tìm thấy"
            }
            // Ném các lỗi DB khác
            throw new Error(`Database error getting conversation history: ${errorMsg}`);
        }
    }

    /**
     * Cập nhật toàn bộ lịch sử tin nhắn cho một cuộc trò chuyện cụ thể thuộc sở hữu của người dùng.
     * Đảm bảo tất cả tin nhắn có dấu thời gian và cập nhật lastActivity.
     * @param conversationId - ID của cuộc trò chuyện.
     * @param userId - ID của người dùng (để xác thực quyền).
     * @param newHistory - Mảng HistoryItems mới.
     * @returns Promise trả về true nếu cập nhật thành công (đúng mục tiêu), ngược lại false.
     * @throws Error nếu có vấn đề tương tác cơ sở dữ liệu.
     */
    async updateConversationHistory(
        conversationId: string,
        userId: string,
        newHistory: HistoryItem[]
    ): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [UpdateHistory Conv: ${conversationId}, User: ${userId}]`;
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return false;

        const historyWithTimestamps = newHistory.map(item => ({
            ...item,
            timestamp: item.timestamp || new Date()
        }));
        try {
            // lastActivity sẽ được cập nhật bởi pre.updateOne hook
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: historyWithTimestamps /* lastActivity sẽ được hook xử lý */ } }
            ).exec();
            return result.matchedCount > 0;

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error updating history: ${errorMsg}`);
            // Xử lý CastError nếu có
            if (error instanceof MongooseError.CastError) {
                logToFile(`${logContext} CastError during update.`);
                return false;
            }
            throw new Error(`Database error updating conversation history: ${errorMsg}`);
        }
    }

    /**
     * Tạo một cuộc trò chuyện mới, trống cho người dùng đã cho một cách tường minh.
    * @param userId - ID của người dùng.
    * @returns Promise trả về thông tin của cuộc trò chuyện mới.
    * @throws Error nếu có vấn đề tương tác cơ sở dữ liệu.
    */
     async createNewConversation(
        userId: string,
        language?: string // << MODIFIED: Add language parameter
    ): Promise<NewConversationResult> {
        const logContext = `${LOG_PREFIX} [CreateNew User: ${userId}, Lang: ${language || 'N/A'}]`;
        logToFile(`${logContext} Creating new conversation.`);
        try {
            const initialTitle = this.getLocalizedDefaultTitle(language); // << Get title based on language
            logToFile(`${logContext} Initial title set to: "${initialTitle}" for language "${language || 'default'}".`);

            const newConversationDoc = await this.model.create({
                userId: userId,
                messages: [],
                customTitle: initialTitle, // << SET customTitle with the language-specific title
                isPinned: false,
            });

            const savedConversation = await this.model.findById(newConversationDoc._id).lean().exec();
            if (!savedConversation) {
                logToFile(`${LOG_PREFIX} CRITICAL: Failed to retrieve newly created conversation ${newConversationDoc._id}`);
                throw new Error("Failed to retrieve newly created conversation.");
            }
            logToFile(`${logContext} New conversation ${savedConversation._id} created with title: "${savedConversation.customTitle}".`);

            return {
                conversationId: savedConversation._id.toString(),
                history: [],
                title: savedConversation.customTitle || initialTitle, // Should be the one from customTitle
                lastActivity: savedConversation.lastActivity,
                isPinned: savedConversation.isPinned || false,
            };
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error creating new conversation: ${errorMsg}`);
            throw new Error(`Database error creating new conversation: ${errorMsg}`);
        }
    }



    /**
     * Xóa một cuộc trò chuyện cụ thể thuộc về người dùng.
     * @param conversationId - ID của cuộc trò chuyện cần xóa.
     * @param userId - ID của người dùng (để xác thực quyền).
     * @returns Promise trả về true nếu xóa thành công, ngược lại false.
     */
    async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [Delete Conv: ${conversationId}, User: ${userId}]`;
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return false;
        try {
            const result = await this.model.deleteOne({ _id: conversationId, userId: userId }).exec();
            return result.deletedCount === 1;
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error deleting conversation: ${errorMsg}`);
            // Trả về false khi có lỗi để an toàn hơn cho người gọi
            return false;
        }
    }

    /**
     * Xóa tất cả tin nhắn khỏi một cuộc trò chuyện cụ thể thuộc sở hữu của người dùng.
     * Giữ lại bản ghi cuộc trò chuyện nhưng đặt lại lịch sử của nó.
     * @param conversationId - ID của cuộc trò chuyện cần xóa tin nhắn.
     * @param userId - ID của người dùng (để xác thực quyền).
     * @returns Promise trả về true nếu xóa tin nhắn thành công, ngược lại false.
     */
    async clearConversationMessages(conversationId: string, userId: string): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [ClearMessages Conv: ${conversationId}, User: ${userId}]`;
        if (!mongoose.Types.ObjectId.isValid(conversationId)) return false;
        try {
            // lastActivity sẽ được cập nhật bởi pre.updateOne hook
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { messages: [] /* lastActivity sẽ được hook xử lý */ } }
            ).exec();
            return result.matchedCount > 0;

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error clearing messages: ${errorMsg}`);
            // Xử lý CastError nếu có
            if (error instanceof MongooseError.CastError) {
                logToFile(`${logContext} CastError during clear messages.`);
                return false;
            }
            // Trả về false khi có lỗi DB khác
            return false;
        }
    }


    /**
    * Đổi tên một cuộc trò chuyện cụ thể.
    */
    async renameConversation(
        conversationId: string,
        userId: string,
        newTitle: string
    ): Promise<RenameResult> { // <-- Thay đổi kiểu trả về
        const logContext = `${LOG_PREFIX} [Rename Conv: ${conversationId}, User: ${userId}]`;
        logToFile(`${logContext} Attempting to rename to "${newTitle.substring(0, 30)}..."`);

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format.`);
            return { success: false, conversationId };
        }

        const trimmedTitle = newTitle.trim().substring(0, MAX_CUSTOM_TITLE_LENGTH);
        if (trimmedTitle.length === 0) {
            logToFile(`${logContext} New title cannot be empty after trimming.`);
            // Bạn có thể quyết định reset customTitle thành null/undefined ở đây nếu muốn
            // Ví dụ:
            // const updateResult = await this.model.updateOne(... { $unset: { customTitle: "" }, $set: { lastActivity: new Date() }});
            // Hoặc đơn giản là trả về lỗi
            return { success: false, conversationId };
        }

        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { customTitle: trimmedTitle, lastActivity: new Date() } }
            ).exec();

            if (result.matchedCount === 0) {
                logToFile(`${logContext} Rename failed: Conversation not found or not authorized.`);
                return { success: false, conversationId };
            }

            // Nếu result.modifiedCount === 0 nhưng matchedCount === 1, có nghĩa là title không thay đổi
            // nhưng thao tác vẫn nhắm đúng document.
            const wasModified = result.modifiedCount > 0;
            logToFile(`${logContext} Renamed. Matched: ${result.matchedCount}, Modified: ${wasModified}`);

            // Trả về tiêu đề đã được chuẩn hóa
            return { success: true, updatedTitle: trimmedTitle, conversationId };

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error renaming: ${errorMsg}`);
            return { success: false, conversationId, updatedTitle: newTitle /* có thể trả về title gốc */ };
        }
    }

    /**
     * Ghim hoặc bỏ ghim một cuộc trò chuyện.
     */
    async pinConversation(
        conversationId: string,
        userId: string,
        pinStatus: boolean
    ): Promise<boolean> {
        const logContext = `${LOG_PREFIX} [Pin Conv: ${conversationId}, User: ${userId}, Status: ${pinStatus}]`;
        logToFile(`${logContext} Attempting to set pin status.`);

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format.`);
            return false;
        }

        try {
            // lastActivity sẽ được cập nhật bởi pre.updateOne hook
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId },
                { $set: { isPinned: pinStatus /* lastActivity sẽ được hook xử lý */ } }
            ).exec();

            if (result.matchedCount === 0) {
                logToFile(`${logContext} Pin/Unpin failed: Conversation not found or not authorized.`);
                return false;
            }
            logToFile(`${logContext} Pin status updated. Modified: ${result.modifiedCount > 0}`);
            return true;
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error updating pin status: ${errorMsg}`);
            return false;
        }
    }

    // --- Phương thức Helper Riêng tư ---

    /**
     * Tạo tiêu đề cho cuộc trò chuyện dựa trên tin nhắn đầu tiên của người dùng hoặc model.
     * Cắt ngắn tiêu đề nếu vượt quá độ dài tối đa.
     * @param messages - Mảng các tin nhắn trong cuộc trò chuyện.
     * @returns Chuỗi tiêu đề được tạo.
     */
     private generateTitleFromMessages(messages: HistoryItem[], language?: string): string { // << ADDED language
        let title = this.getLocalizedDefaultTitle(language); // << Use localized default

        const firstUserMessageText = messages
            .find(msg => msg.role === 'user')?.parts
            ?.find(p => p.text)?.text?.trim();

        const firstModelMessageText = messages
            .find(msg => msg.role === 'model')?.parts
            ?.find(p => p.text)?.text?.trim();

        if (firstUserMessageText && firstUserMessageText.length > 0) {
            title = firstUserMessageText;
        } else if (firstModelMessageText && firstModelMessageText.length > 0) {
            title = firstModelMessageText;
        }

        if (title.length > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
        }
        return title;
    }
}