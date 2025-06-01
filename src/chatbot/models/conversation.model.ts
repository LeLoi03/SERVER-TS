// src/chatbot/models/conversation.model.ts
import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { ChatHistoryItem, SourceItem } from '../shared/types'; // Import thêm SourceItem

// Định nghĩa cấu trúc cho một Part (để Mongoose biết kiểu)
const partSchema = new Schema({
    text: { type: String },
    inlineData: { // Dành cho ảnh nhỏ, v.v. gửi trực tiếp
        mimeType: { type: String },
        data: { type: String } // Base64 encoded data
    },
    fileData: {
        mimeType: { type: String, required: false }, // required: false vì không phải part nào cũng là fileData
        fileUri: { type: String, required: false }   // required: false
    },
    functionCall: {
        name: { type: String },
        args: { type: Schema.Types.Mixed }
    },
    functionResponse: {
        name: { type: String },
        response: { type: Schema.Types.Mixed }
    }
}, { _id: false, minimize: false }); // minimize: false để giữ lại các object rỗng nếu cần

const sourceItemSchema = new Schema<SourceItem>({
    name: { type: String, required: true },
    url: { type: String, required: true },
    type: { type: String }
}, { _id: false });

const historyItemSchema = new Schema<ChatHistoryItem>({ // Explicitly type with ChatHistoryItem
    role: {
        type: String,
        required: true,
        enum: ['user', 'model', 'function', 'system']
    },
    parts: {
        type: [partSchema],
        required: true
    },
    timestamp: { type: Date, default: Date.now },
    uuid: { type: String, index: true, sparse: true }, // sparse: true nếu không phải mọi item đều có uuid
    userFileInfo: [{
        name: { type: String, required: true },
        size: { type: Number, required: true },
        type: { type: String, required: true },
        googleFileUri: { type: String, required: true },
        _id: false
    }],
    sources: { // <<< THÊM MỚI: Chỉ có ý nghĩa với role: 'model'
        type: [sourceItemSchema], // Mảng các SourceItem
        default: undefined // Để không tạo mảng rỗng nếu không có sources
    },
    // Các trường khác của ChatHistoryItem nếu có (ví dụ: action, thoughts)
    // thoughts và action có thể cần schema riêng nếu cấu trúc phức tạp
    thoughts: { type: Schema.Types.Mixed, default: undefined }, // Giữ linh hoạt
    action: { type: Schema.Types.Mixed, default: undefined }    // Giữ linh hoạt
}, { _id: false, minimize: false });


export interface IConversation extends Document {
    _id: Types.ObjectId;
    userId: string;
    messages: ChatHistoryItem[]; // messages sẽ là một mảng các ChatHistoryItem
    language?: string;
    lastActivity: Date;
    status?: string;
    customTitle?: string;
    isPinned?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>({
    userId: {
        type: String,
        required: true,
        index: true
    },
    messages: {
        type: [historyItemSchema], // Sử dụng historyItemSchema đã định nghĩa
        default: []
    },
    language: { type: String },
    lastActivity: { type: Date, default: Date.now, index: true },
    status: { type: String, default: 'active' }, // Ví dụ: 'active', 'archived', 'deleted'
    customTitle: { type: String, trim: true, maxlength: 120 },
    isPinned: { type: Boolean, default: false, index: true },
}, {
    timestamps: true, // Tự động thêm createdAt và updatedAt
    collection: 'conversations'
});

// Cập nhật lastActivity mỗi khi document được save
conversationSchema.pre('save', function (next) {
    if (this.isModified() || this.isNew) {
        this.lastActivity = new Date();
    }
    next();
});



conversationSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
        const updateOperators = ['$set', '$unset', '$inc', '$mul', '$rename', '$min', '$max', '$currentDate'];
        const usesUpdateOperator = Object.keys(update).some(key => updateOperators.includes(key));

        if (usesUpdateOperator) {
            if (update.$set) {
                (update.$set as any).lastActivity = new Date();
            } else {
                this.set({ '$set': { lastActivity: new Date() } });
            }
        } else if (Object.keys(update).length > 0 && !update.$set) {
            this.set({ '$set': { lastActivity: new Date() } });
        }
    }
    next();
});


conversationSchema.pre('updateOne', function (next) { // Thường dùng cho các update không trả về document
    const update = this.getUpdate();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
        const updateOperators = ['$set', '$unset', '$inc', '$mul', '$rename', '$min', '$max', '$currentDate'];
        const usesUpdateOperator = Object.keys(update).some(key => updateOperators.includes(key));

        if (usesUpdateOperator) {
            if (update.$set) {
                (update.$set as any).lastActivity = new Date();
            } else {
                this.set({ '$set': { lastActivity: new Date() } });
            }
        } else if (Object.keys(update).length > 0 && !update.$set) {
            this.set({ '$set': { lastActivity: new Date() } });
        }
    }
    next();
});


conversationSchema.index(
    { 'messages.parts.text': 'text' },
    { default_language: 'english' }
);

const ConversationModel: Model<IConversation> = mongoose.model<IConversation>('Conversation', conversationSchema);
export default ConversationModel;