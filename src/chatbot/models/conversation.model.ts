import mongoose, { Schema, Document, Model } from 'mongoose';
import { HistoryItem } from '../shared/types'; // Import kiểu dữ liệu HistoryItem và Part

// Định nghĩa cấu trúc cho một Part (để Mongoose biết kiểu)
// Lưu ý: Cấu trúc này cần khớp với định nghĩa Part của Google AI SDK
const partSchema = new Schema({
    text: { type: String },
    inlineData: {
         mimeType: { type: String },
         data: { type: String } // Base64 encoded data
    },
    functionCall: {
        name: { type: String },
        args: { type: Schema.Types.Mixed } // Dùng Mixed cho args linh hoạt
    },
    functionResponse: {
         name: { type: String },
         response: { type: Schema.Types.Mixed } // Dùng Mixed cho response linh hoạt
    }
}, { _id: false }); // Không cần _id cho sub-document Part

// Định nghĩa cấu trúc cho một HistoryItem
const historyItemSchema = new Schema({
    role: {
        type: String,
        required: true,
        enum: ['user', 'model', 'function'] // Các role hợp lệ
    },
    parts: {
        type: [partSchema], // Mảng các Part
        required: true
    },
    timestamp: { type: Date, default: Date.now } // Thêm timestamp cho từng message
}, { _id: false }); // Không cần _id cho sub-document HistoryItem

// Định nghĩa Schema chính cho Conversation
export interface IConversation extends Document {
    userId: string;
    messages: HistoryItem[]; // Sử dụng lại kiểu HistoryItem đã định nghĩa
    createdAt: Date;
    updatedAt: Date;
    language?: string; // Optional metadata
    lastActivity: Date;
    status?: string; // Optional metadata
}

const conversationSchema = new Schema<IConversation>({
    userId: {
        type: String,
        required: true,
        index: true // Đánh index cho userId để query nhanh hơn
    },
    messages: {
        type: [historyItemSchema], // Mảng các HistoryItem
        default: []
    },
    language: { type: String },
    lastActivity: { type: Date, default: Date.now, index: true },
    status: { type: String, default: 'active' }
}, {
    timestamps: true, // Tự động thêm createdAt và updatedAt
    collection: 'conversations' // Tên collection trong MongoDB
});

// Cập nhật lastActivity mỗi khi document được save
conversationSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});
// Cập nhật lastActivity khi dùng findByIdAndUpdate, updateOne, etc.
conversationSchema.pre('findOneAndUpdate', function(next) {
  this.set({ lastActivity: new Date() });
  next();
});
 conversationSchema.pre('updateOne', function(next) {
  this.set({ lastActivity: new Date() });
  next();
});


// Tạo Model
const ConversationModel: Model<IConversation> = mongoose.model<IConversation>('Conversation', conversationSchema);

export default ConversationModel;