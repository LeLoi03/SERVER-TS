// src/chatbot/services/conversationHistory.service.ts
import mongoose, { Types, Error as MongooseError } from 'mongoose';
import ConversationModel, { IConversation } from '../models/conversation.model'; // Đảm bảo đường dẫn đúng
import { HistoryItem } from '../shared/types'; // Đảm bảo đường dẫn đúng
import logToFile from '../../utils/logger'; // Đảm bảo đường dẫn đúng

const LOG_PREFIX = "[HistoryService]";
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_TITLE_LENGTH = 50;
const TRUNCATE_SUFFIX = '...';

/**
 * Định nghĩa kiểu dữ liệu cho metadata của cuộc trò chuyện.
 */
export interface ConversationMetadata {
    id: string;
    title: string;
    lastActivity: Date;
}

/**
 * Service quản lý lịch sử cuộc trò chuyện của người dùng.
 */
export class ConversationHistoryService {
    // Model là readonly vì không nên gán lại sau khi khởi tạo
    private readonly model: mongoose.Model<IConversation>;

    constructor() {
        this.model = ConversationModel;
        logToFile(`${LOG_PREFIX} Initialized.`);
    }

    /**
     * Lấy danh sách metadata cuộc trò chuyện cho một người dùng cụ thể.
     * @param userId - ID của người dùng.
     * @param limit - Số lượng cuộc trò chuyện tối đa trả về. Mặc định là 20.
     * @returns Promise trả về một mảng ConversationMetadata. Trả về mảng rỗng nếu có lỗi.
     */
    async getConversationListForUser(
        userId: string,
        limit: number = DEFAULT_CONVERSATION_LIMIT
    ): Promise<ConversationMetadata[]> {
        const logContext = `${LOG_PREFIX} [List User: ${userId}, Limit: ${limit}]`;
        logToFile(`${logContext} Fetching conversation list.`);

        try {
            // Sử dụng lean() để cải thiện hiệu suất và trả về plain JavaScript objects
            // Điều này cũng thường giúp tránh các vấn đề phức tạp về kiểu của Mongoose Document
            const conversations = await this.model.find({ userId })
                .sort({ lastActivity: -1 }) // Sắp xếp mới nhất trước
                .limit(limit)
                .select('_id messages lastActivity') // Chỉ chọn các trường cần thiết
                .lean() // Quan trọng: Lấy plain objects thay vì Mongoose Documents
                .exec();

            const metadataList: ConversationMetadata[] = conversations.map(conv => {
                // Hàm helper để tạo tiêu đề
                const title = this.generateTitleFromMessages(conv.messages || []);
                return {
                    // _id từ lean object vẫn là ObjectId, cần toString()
                    id: conv._id.toString(),
                    title: title,
                    // lastActivity đã là kiểu Date từ schema
                    lastActivity: conv.lastActivity,
                };
            });

            logToFile(`${logContext} Found ${metadataList.length} conversations.`);
            return metadataList;

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error fetching conversation list: ${errorMsg}`);
            // Trả về mảng rỗng khi có lỗi, cho phép frontend xử lý mượt mà hơn
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
    async getLatestOrCreateConversation(userId: string): Promise<{ conversationId: string; history: HistoryItem[] }> {
        const logContext = `${LOG_PREFIX} [GetOrCreate User: ${userId}]`;
        logToFile(`${logContext} Attempting to find latest or create new conversation.`);

        try {
            // Tìm cuộc trò chuyện gần đây nhất của người dùng
            // Không dùng lean() ở đây vì chúng ta cần gọi .save() trên document
            const latestConversation = await this.model.findOne({ userId })
                .sort({ lastActivity: -1 })
                .exec();

            if (latestConversation) {
                logToFile(`${logContext} Found latest conversation: ${latestConversation._id}. Updating lastActivity.`);
                // Cập nhật lastActivity để đánh dấu là đang hoạt động
                latestConversation.lastActivity = new Date();
                await latestConversation.save(); // Lưu cập nhật dấu thời gian

                // Kiểm tra _id tồn tại trước khi sử dụng (phòng ngừa)
                if (!latestConversation._id) {
                    logToFile(`${logContext} Error: Found conversation document is missing _id.`);
                    throw new Error("Found conversation document is missing _id");
                }
                return {
                    // Sử dụng type assertion để đảm bảo _id là ObjectId và có thể gọi toString()
                    conversationId: (latestConversation._id as Types.ObjectId).toString(),
                    history: latestConversation.messages || []
                };
            } else {
                // Không tìm thấy cuộc trò chuyện nào, tạo mới
                logToFile(`${logContext} No existing conversation found. Creating new.`);
                return this.createNewConversation(userId); // Tái sử dụng phương thức tạo mới
            }
        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logContext} Error: ${errorMsg}`);
            // Ném lại lỗi cụ thể hơn để lớp gọi xử lý
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
        logToFile(`${logContext} Fetching history.`);

        // Kiểm tra định dạng conversationId sớm
        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format.`);
            return null; // Trả về null cho định dạng ID không hợp lệ
        }

        try {
            const conversation = await this.model
                .findOne({ _id: conversationId, userId })
                .select({ messages: limit && limit > 0 ? { $slice: -limit } : 1 })
                .lean<{ _id: Types.ObjectId; messages?: HistoryItem[] }>()  // ép kiểu kết quả của lean
                .exec();
            if (conversation) {
                logToFile(`${logContext} History found. Message count: ${conversation.messages?.length ?? 0}`);
                // messages từ lean object sẽ là mảng thông thường (hoặc undefined/null)
                return conversation.messages || [];
            } else {
                logToFile(`${logContext} Conversation not found or not authorized.`);
                return null; // Không tìm thấy hoặc người dùng không khớp
            }

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
        logToFile(`${logContext} Updating history. New length: ${newHistory.length}.`);

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format for update.`);
            return false;
        }

        // Thêm dấu thời gian cho tin nhắn nếu thiếu
        const historyWithTimestamps = newHistory.map(item => ({
            ...item,
            timestamp: item.timestamp || new Date() // Gán timestamp nếu chưa có
        }));

        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId }, // Điều kiện tìm kiếm và xác thực quyền
                {
                    $set: {
                        messages: historyWithTimestamps,
                        lastActivity: new Date() // Cập nhật lastActivity thủ công
                    }
                }
            ).exec();

            // Kiểm tra xem có document nào khớp với query không
            if (result.matchedCount === 0) {
                logToFile(`${logContext} Update failed: Conversation not found or not authorized.`);
                return false; // Không tìm thấy mục tiêu hoặc người dùng không khớp
            }

            // Ghi log thành công, cho biết có thực sự sửa đổi hay không
            logToFile(`${logContext} History update targeted successfully. Modified: ${result.modifiedCount > 0}`);
            return true; // Thao tác đã nhắm đúng document

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
    * @returns Promise trả về ID cuộc trò chuyện mới và lịch sử trống.
    * @throws Error nếu có vấn đề tương tác cơ sở dữ liệu.
    */
    async createNewConversation(userId: string): Promise<{ conversationId: string; history: HistoryItem[] }> {
        const logContext = `${LOG_PREFIX} [CreateNew User: ${userId}]`;
        logToFile(`${logContext} Explicitly creating new conversation.`);

        try {
            const newConversation = await this.model.create({
                userId: userId,
                messages: [], // Bắt đầu với lịch sử trống
                lastActivity: new Date(), // Đặt lastActivity ban đầu
                // Các trường khác có giá trị mặc định trong schema sẽ được áp dụng
            });
            logToFile(`${logContext} Created new conversation: ${newConversation._id}`);

            // Kiểm tra _id tồn tại (phòng ngừa)
            if (!newConversation._id) {
                logToFile(`${logContext} Error: Created conversation document is missing _id.`);
                throw new Error("Created conversation document is missing _id");
            }
            return {
                // Sử dụng type assertion để đảm bảo _id là ObjectId
                conversationId: (newConversation._id as Types.ObjectId).toString(),
                history: [] // Lịch sử ban đầu là trống
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
        logToFile(`${logContext} Attempting to delete conversation.`);

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format for delete.`);
            return false;
        }

        try {
            const result = await this.model.deleteOne({
                _id: conversationId,
                userId: userId // Đảm bảo chỉ xóa của đúng người dùng
            }).exec();

            if (result.deletedCount === 1) {
                logToFile(`${logContext} Deletion successful.`);
                return true;
            } else {
                logToFile(`${logContext} Delete failed: Conversation not found or not authorized.`);
                return false; // Không tìm thấy hoặc không có quyền
            }
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
        logToFile(`${logContext} Attempting to clear messages.`);

        if (!mongoose.Types.ObjectId.isValid(conversationId)) {
            logToFile(`${logContext} Invalid conversationId format for clear.`);
            return false;
        }

        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId }, // Điều kiện tìm kiếm và xác thực quyền
                {
                    $set: {
                        messages: [], // Đặt lại mảng messages thành rỗng
                        lastActivity: new Date() // Cập nhật lastActivity
                    }
                }
            ).exec();

            if (result.matchedCount === 1) {
                logToFile(`${logContext} Messages cleared successfully. Modified: ${result.modifiedCount > 0}`);
                return true; // Tìm thấy và nhắm đúng document
            } else {
                logToFile(`${logContext} Clear messages failed: Conversation not found or not authorized.`);
                return false; // Không tìm thấy hoặc không có quyền
            }
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

    // --- Phương thức Helper Riêng tư ---

    /**
     * Tạo tiêu đề cho cuộc trò chuyện dựa trên tin nhắn đầu tiên của người dùng hoặc model.
     * Cắt ngắn tiêu đề nếu vượt quá độ dài tối đa.
     * @param messages - Mảng các tin nhắn trong cuộc trò chuyện.
     * @returns Chuỗi tiêu đề được tạo.
     */
    private generateTitleFromMessages(messages: HistoryItem[]): string {
        let title = 'Cuộc trò chuyện mới'; // Tiêu đề mặc định
        // Thêm ngôn ngữ sau này

        // Tìm nội dung text của tin nhắn 'user' đầu tiên
        const firstUserMessageText = messages
            .find(msg => msg.role === 'user')?.parts
            ?.find(p => p.text)?.text?.trim(); // Lấy text và loại bỏ khoảng trắng thừa

        // Tìm nội dung text của tin nhắn 'model' đầu tiên (nếu không có tin nhắn user)
        const firstModelMessageText = messages
            .find(msg => msg.role === 'model')?.parts
            ?.find(p => p.text)?.text?.trim();

        // Ưu tiên tin nhắn của người dùng làm tiêu đề
        if (firstUserMessageText && firstUserMessageText.length > 0) {
            title = firstUserMessageText;
        } else if (firstModelMessageText && firstModelMessageText.length > 0) {
            // Nếu không có tin nhắn user, dùng tin nhắn model
            title = firstModelMessageText;
        }
        // Nếu cả hai đều trống hoặc không có, giữ tiêu đề mặc định

        // Cắt ngắn tiêu đề nếu quá dài
        if (title.length > MAX_TITLE_LENGTH) {
            title = title.substring(0, MAX_TITLE_LENGTH - TRUNCATE_SUFFIX.length) + TRUNCATE_SUFFIX;
        }

        return title;
    }
}

// Có thể export một instance nếu bạn muốn dùng singleton pattern
// export const conversationHistoryService = new ConversationHistoryService();