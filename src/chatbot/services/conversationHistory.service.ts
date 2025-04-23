// src/chatbot/services/conversationHistory.services.ts
import mongoose, { Types } from 'mongoose'; // Import Types
import ConversationModel, { IConversation } from '../models/conversation.model';
import { HistoryItem } from '../shared/types';
import logToFile from '../../utils/logger';



    
// Định nghĩa kiểu dữ liệu cho metadata trả về frontend
export interface ConversationMetadata {
    id: string; // Chính là _id của MongoDB
    title: string; // Tin nhắn đầu tiên hoặc tiêu đề tự tạo
    lastActivity: Date;
}

export class ConversationHistoryService {
    private model: mongoose.Model<IConversation>;

    constructor() {
        this.model = ConversationModel;
        logToFile('[History Service] Initialized.');
    }

    // --- PHƯƠNG THỨC MỚI ---
    /**
     * Lấy danh sách metadata các cuộc hội thoại của người dùng.
     * @param userId ID của người dùng.
     * @param limit Giới hạn số lượng cuộc hội thoại trả về (mặc định 20).
     * @returns Promise chứa mảng ConversationMetadata.
     */
    async getConversationListForUser(userId: string, limit: number = 20): Promise<ConversationMetadata[]> {
        logToFile(`[History Service] Getting conversation list for userId: ${userId}, limit: ${limit}`);
        try {
            const conversations = await this.model.find({ userId })
                .sort({ lastActivity: -1 }) // Sắp xếp mới nhất lên đầu
                .limit(limit)
                .select('_id messages lastActivity') // Chỉ lấy các trường cần thiết
                .lean() // Sử dụng lean() để trả về plain JS objects, nhanh hơn
                .exec();

            const metadataList: ConversationMetadata[] = conversations.map(conv => {
                let title = 'Untitled Conversation';
                // Lấy text của tin nhắn đầu tiên làm title (ưu tiên user)
                const firstUserMessage = conv.messages?.find(msg => msg.role === 'user')?.parts?.find(p => p.text)?.text;
                const firstModelMessage = conv.messages?.find(msg => msg.role === 'model')?.parts?.find(p => p.text)?.text;

                if (firstUserMessage) {
                    title = firstUserMessage;
                } else if (firstModelMessage) {
                    title = firstModelMessage;
                }

                // Rút gọn title nếu quá dài
                if (title.length > 50) {
                    title = title.substring(0, 47) + '...';
                }

                return {
                    id: conv._id.toString(),
                    title: title,
                    lastActivity: conv.lastActivity,
                };
            });

            logToFile(`[History Service] Found ${metadataList.length} conversations for userId: ${userId}`);
            return metadataList;

        } catch (error: any) {
            logToFile(`[History Service] Error getting conversation list for userId ${userId}: ${error.message}`);
            // Không nên throw lỗi ở đây, trả về mảng rỗng để frontend xử lý
            return [];
        }
    }
    // --- KẾT THÚC PHƯƠNG THỨC MỚI ---


    /**
     * Bắt đầu cuộc hội thoại mới hoặc lấy lại cuộc hội thoại gần nhất của user.
     * @param userId ID của người dùng đã xác thực.
     * @returns Promise chứa conversationId và history.
     * @throws Lỗi nếu có vấn đề khi tương tác DB.
     */
    async getLatestOrCreateConversation(userId: string): Promise<{ conversationId: string; history: HistoryItem[] }> {
        logToFile(`[History Service] Getting latest or creating conversation for userId: ${userId}`);
        try {
            // Tìm cuộc hội thoại gần nhất của user (dựa vào lastActivity hoặc updatedAt)
            const existingConversation = await this.model.findOne({ userId })
                                                .sort({ lastActivity: -1 }) // Ưu tiên cái mới nhất
                                                .exec();

            if (existingConversation) {
                logToFile(`[History Service] Found latest conversationId: ${existingConversation._id} for userId: ${userId}`);
                // Cập nhật lastActivity để đánh dấu là đang hoạt động
                existingConversation.lastActivity = new Date();
                await existingConversation.save(); // Lưu thay đổi lastActivity
                return {
                    conversationId: (existingConversation._id as Types.ObjectId).toString(),
                    history: existingConversation.messages || []
                };
            } else {
                // Tạo cuộc hội thoại mới
                logToFile(`[History Service] No existing conversation found, creating new for userId: ${userId}`);
                const newConversation = await this.model.create({ userId: userId, messages: [] });

                logToFile(`[History Service] Created new conversationId: ${newConversation._id} for userId: ${userId}`);
                return {
                    conversationId: (newConversation._id as Types.ObjectId).toString(),
                    history: []
                };
            }
        } catch (error: any) {
            logToFile(`[History Service] Error in getLatestOrCreateConversation for userId ${userId}: ${error.message}`);
            throw new Error(`Database error while getting/creating conversation: ${error.message}`);
        }
    }

    /**
     * Lấy lịch sử của một cuộc hội thoại cụ thể.
     * @param conversationId ID của cuộc hội thoại.
     * @param limit Số lượng tin nhắn cuối cùng cần lấy (optional).
     * @returns Promise chứa mảng HistoryItem hoặc null nếu không tìm thấy.
     * @throws Lỗi nếu có vấn đề khi tương tác DB.
     */
    async getConversationHistory(conversationId: string, userId: string, limit?: number): Promise<HistoryItem[] | null> {
        logToFile(`[History Service] Getting history for conversationId: ${conversationId}, userId: ${userId}, limit: ${limit}`);
        try {
            let query = this.model.findOne({ _id: conversationId, userId: userId }); // <<< THÊM ĐIỀU KIỆN userId
    
            if (limit && limit > 0) {
                // Assert rằng kiểu trả về tương thích với kiểu hiện tại của query
                query = query.select({ messages: { $slice: -limit } }) as typeof query;
                logToFile(`[History Service] Applying message limit: ${limit}`);
            } else {
                query = query.select('messages') as typeof query;
            }
    
            const conversation: IConversation | null = await query.exec();
    
            // Nếu TypeScript vẫn báo lỗi ở dòng trên, bạn có thể thử ép kiểu:
            // const conversation = await query.exec() as IConversation | null;
    
            if (conversation) {
                logToFile(`[History Service] Found history for conversationId: ${conversationId}. Message count: ${conversation.messages?.length ?? 0}`);
                return conversation.messages || [];
            } else {
                // Có thể không tìm thấy do sai ID hoặc không thuộc user này
                logToFile(`[History Service] Conversation not found or not authorized for id: ${conversationId}, userId: ${userId}`);
                return null;
            }
        } catch (error: any) {
            if (error instanceof mongoose.Error.CastError) {
                logToFile(`[History Service] Invalid conversationId format: ${conversationId}`);
                return null;
            }
            logToFile(`[History Service] Error getting history for conversationId ${conversationId}: ${error.message}`);
            throw new Error(`Database error while getting conversation history: ${error.message}`);
        }
    }

    /**
     * Cập nhật toàn bộ lịch sử cho một cuộc hội thoại.
     * @param conversationId ID của cuộc hội thoại.
     * @param newHistory Mảng HistoryItem mới.
     * @returns Promise<void>
     * @throws Lỗi nếu có vấn đề khi tương tác DB hoặc không tìm thấy conversation.
     */
    async updateConversationHistory(conversationId: string, userId: string, newHistory: HistoryItem[]): Promise<boolean> { // Trả về boolean cho biết thành công hay không
        logToFile(`[History Service] Updating history for conversationId: ${conversationId}, userId: ${userId}. New history length: ${newHistory.length}`);
         // Phase 3: Thêm logic giới hạn kích thước ở đây nếu muốn
         // if (newHistory.length > 100) {
         //     logToFile(`[History Service] Truncating history for ${conversationId} to last 100 messages.`);
         //     newHistory = newHistory.slice(-100);
         // }

         // Thêm timestamp cho các message mới nếu chưa có (đảm bảo tính nhất quán)
         const historyWithTimestamps = newHistory.map(item => ({
            ...item,
            timestamp: item.timestamp || new Date() // Thêm timestamp nếu thiếu
         }));


        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId }, // <<< THÊM ĐIỀU KIỆN userId
                {
                    $set: {
                        messages: historyWithTimestamps, // Lưu lịch sử đã có timestamp
                        lastActivity: new Date() // Cập nhật lastActivity thủ công với updateOne
                    }
                }
            ).exec();

            if (result.matchedCount === 0) {
                logToFile(`[History Service] Update failed: Conversation not found or not authorized for id: ${conversationId}, userId: ${userId}`);
                return false; // Không tìm thấy hoặc không đúng user
            }
            logToFile(`[History Service] Successfully updated history for conversationId: ${conversationId}. Modified: ${result.modifiedCount > 0}`);
            return true; // Cập nhật thành công (ngay cả khi nội dung không đổi)



        } catch (error: any) {
            if (error instanceof mongoose.Error.CastError) {
                logToFile(`[History Service] Invalid conversationId format for update: ${conversationId}`);
                return false;
            }
            logToFile(`[History Service] Error updating history for conversationId ${conversationId}: ${error.message}`);
            throw new Error(`Database error while updating conversation history: ${error.message}`); // Ném lỗi để handler cấp cao hơn xử lý
        }
    }
    
    // --- Phương thức tạo conversation mới một cách tường minh ---
    async createNewConversation(userId: string): Promise<{ conversationId: string; history: HistoryItem[] }> {
        logToFile(`[History Service] Explicitly creating new conversation for userId: ${userId}`);
         try {
            const newConversation = await this.model.create({
                userId: userId,
                messages: [], // Bắt đầu với history rỗng
            });
            logToFile(`[History Service] Created new conversationId: ${newConversation._id} for userId: ${userId}`);
            return {
                conversationId: (newConversation._id as Types.ObjectId).toString(),
                history: []
            };
        } catch (error: any) {
            logToFile(`[History Service] Error in createNewConversation for userId ${userId}: ${error.message}`);
            throw new Error(`Database error while creating new conversation: ${error.message}`);
        }
    }


      // --- NEW: DELETE CONVERSATION ---
    /**
     * Deletes a specific conversation belonging to a user.
     * @param conversationId The ID of the conversation to delete.
     * @param userId The ID of the user requesting the deletion (for authorization).
     * @returns Promise<boolean> True if deletion was successful, false otherwise.
     */
    async deleteConversation(conversationId: string, userId: string): Promise<boolean> {
        logToFile(`[History Service] Attempting to delete conversationId: ${conversationId} for userId: ${userId}`);
        try {
            const result = await this.model.deleteOne({
                _id: conversationId,
                userId: userId // <<< CRITICAL: Ensure only the owner can delete
            }).exec();

            if (result.deletedCount === 1) {
                logToFile(`[History Service] Successfully deleted conversationId: ${conversationId}`);
                return true;
            } else {
                logToFile(`[History Service] Delete failed: Conversation not found or not authorized for id: ${conversationId}, userId: ${userId}`);
                return false;
            }
        } catch (error: any) {
            if (error instanceof mongoose.Error.CastError) {
                logToFile(`[History Service] Invalid conversationId format for delete: ${conversationId}`);
                return false;
            }
            logToFile(`[History Service] Error deleting conversationId ${conversationId}: ${error.message}`);
            // Depending on policy, you might want to throw or just return false
            // Returning false is often safer for the caller.
            return false;
            // throw new Error(`Database error while deleting conversation: ${error.message}`);
        }
    }

    // --- NEW: CLEAR CONVERSATION MESSAGES ---
    /**
     * Clears all messages from a specific conversation, keeping the conversation entry.
     * @param conversationId The ID of the conversation to clear.
     * @param userId The ID of the user requesting the clear operation (for authorization).
     * @returns Promise<boolean> True if clearing was successful, false otherwise.
     */
    async clearConversationMessages(conversationId: string, userId: string): Promise<boolean> {
        logToFile(`[History Service] Attempting to clear messages for conversationId: ${conversationId} for userId: ${userId}`);
        try {
            const result = await this.model.updateOne(
                { _id: conversationId, userId: userId }, // <<< CRITICAL: Ensure only the owner can clear
                {
                    $set: {
                        messages: [], // Set messages to an empty array
                        lastActivity: new Date() // Update last activity timestamp
                    }
                }
            ).exec();

            if (result.matchedCount === 1) {
                logToFile(`[History Service] Successfully cleared messages for conversationId: ${conversationId}. Modified: ${result.modifiedCount > 0}`);
                // Return true even if modifiedCount is 0 (already empty), as the operation target was found.
                return true;
            } else {
                logToFile(`[History Service] Clear messages failed: Conversation not found or not authorized for id: ${conversationId}, userId: ${userId}`);
                return false;
            }
        } catch (error: any) {
            if (error instanceof mongoose.Error.CastError) {
                logToFile(`[History Service] Invalid conversationId format for clear: ${conversationId}`);
                return false;
            }
            logToFile(`[History Service] Error clearing messages for conversationId ${conversationId}: ${error.message}`);
            return false;
            // throw new Error(`Database error while clearing conversation messages: ${error.message}`);
        }
    }
}
