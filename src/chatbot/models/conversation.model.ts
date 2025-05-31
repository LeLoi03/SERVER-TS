// src/chatbot/models/conversation.model.ts
import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { ChatHistoryItem } from '../shared/types'; // Import kiểu dữ liệu ChatHistoryItem

// Định nghĩa cấu trúc cho một Part (để Mongoose biết kiểu)
const partSchema = new Schema({
    text: { type: String },
    inlineData: { // Dành cho ảnh nhỏ, v.v. gửi trực tiếp
        mimeType: { type: String },
        data: { type: String } // Base64 encoded data
    },
    fileData: { // Dành cho file lớn đã upload qua File API
        mimeType: { type: String, required: true },
        fileUri: { type: String, required: true },
        // KHÔNG CÓ displayName, originalSize ở đây
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

const historyItemSchema = new Schema({
    role: {
        type: String,
        required: true,
        enum: ['user', 'model', 'function', 'system']
    },
    parts: {
        type: [partSchema], // Mảng các Part objects
        required: true
    },
    timestamp: { type: Date, default: Date.now },
    uuid: { type: String, index: true, sparse: true },
     userFileInfo: [{ // Chỉ có ý nghĩa với role: 'user'
        name: { type: String, required: true }, // Thêm required nếu cần
        size: { type: Number, required: true },
        type: { type: String, required: true },
        googleFileUri: { type: String, required: true },
        _id: false // QUAN TRỌNG: Đảm bảo có dòng này
    }]
}, { _id: false, minimize: false }); // minimize: false có thể vẫn cần thiết cho parts


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
    status: { type: String, default: 'active' },
    customTitle: { type: String, trim: true, maxlength: 120 },
    isPinned: { type: Boolean, default: false, index: true },
}, {
    timestamps: true,
    collection: 'conversations'
});


// Cập nhật lastActivity mỗi khi document được save
conversationSchema.pre('save', function (next) {
    // Chỉ cập nhật nếu có thay đổi thực sự hoặc là document mới
    if (this.isModified() || this.isNew) {
        this.lastActivity = new Date();
    }
    next();
});



conversationSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate();

    // Kiểm tra xem update có phải là một đối tượng và không phải là aggregation pipeline
    // (Aggregation pipeline thường là một mảng các stages)
    if (update && typeof update === 'object' && !Array.isArray(update)) {
        // Kiểm tra xem có toán tử update nào được sử dụng không
        // Nếu không có, có thể không cần thêm $set
        const updateOperators = ['$set', '$unset', '$inc', '$mul', '$rename', '$min', '$max', '$currentDate'];
        const usesUpdateOperator = Object.keys(update).some(key => updateOperators.includes(key));

        if (usesUpdateOperator) {
            // Nếu đã có $set, thêm lastActivity vào đó
            if (update.$set) {
                (update.$set as any).lastActivity = new Date();
            } else {
                // Nếu chưa có $set, nhưng có các toán tử khác, chúng ta vẫn có thể thêm $set mới
                // Tuy nhiên, cần cẩn thận hơn nếu bạn sử dụng các toán tử phức tạp.
                // Một cách an toàn là chỉ thêm nếu không có $set nào khác
                // hoặc nếu bạn chắc chắn về cấu trúc update.
                // Để đơn giản, nếu không có $set, ta tạo mới:
                this.set({ '$set': { lastActivity: new Date() } }); // Sử dụng this.set() của Query
            }
        } else if (Object.keys(update).length > 0 && !update.$set) {
            // Trường hợp update trực tiếp các trường (ví dụ: { field: value })
            // Mongoose sẽ tự động chuyển thành $set, nhưng để chắc chắn,
            // ta có thể can thiệp ở đây hoặc để Mongoose xử lý.
            // Để an toàn nhất, nếu không có toán tử và có các trường được update trực tiếp,
            // ta cũng có thể thêm lastActivity vào $set.
            // Tuy nhiên, cách tiếp cận tốt nhất là luôn sử dụng toán tử $set trong service.
            // Giữ nguyên logic cũ của bạn bằng cách thêm vào $set:
            // Cách này không hoàn toàn chính xác vì this.getUpdate() trả về toàn bộ object update
            // Nếu update là { name: "new name" }, thì (update as any).$set sẽ là undefined.
            // Cách đúng hơn là dùng this.updateOne({}, { $set: { lastActivity: new Date() } })
            // hoặc this.set({ '$set': { lastActivity: new Date() }})
            this.set({ '$set': { lastActivity: new Date() } });
        }
    }
    next();
});

conversationSchema.pre('updateOne', function (next) {
    const update = this.getUpdate();
    if (update && typeof update === 'object' && !Array.isArray(update)) {
        // Logic tương tự như findOneAndUpdate
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


// Đánh text index trên trường messages.parts.text để tìm kiếm
// MongoDB sẽ tự động xử lý việc index các phần tử trong mảng messages và parts
conversationSchema.index(
    { 'messages.parts.text': 'text' },
    { default_language: 'english' } // Có thể đặt ngôn ngữ mặc định cho text search
);


const ConversationModel: Model<IConversation> = mongoose.model<IConversation>('Conversation', conversationSchema);
export default ConversationModel;