// models/feedback.send.ts
export interface Feedback {
    id: string;
    organizedId: string;
    creatorId: string;
    firstName: string;
    lastName: string;
    avatar: string;
    description: string;
    star: number;
    createdAt: string;
    updatedAt: string;
}