import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../../server';
import { ConferenceResponse } from '../types/conference.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// Hàm so sánh mảng không quan tâm thứ tự
function areArraysEqual(arr1: any[] | undefined, arr2: any[] | undefined): boolean {
    if (!arr1 && !arr2) return true; // Cả hai đều undefined
    if (!arr1 || !arr2) return false; // Một trong hai là undefined
    if (arr1.length !== arr2.length) return false;

    const sortedArr1 = [...arr1].sort();
    const sortedArr2 = [...arr2].sort();

    for (let i = 0; i < sortedArr1.length; i++) {
        if (sortedArr1[i] !== sortedArr2[i]) return false;
    }

    return true;
}


function shouldSendUpdateProfileNotification(user: UserResponse): boolean {
    const settings = user.setting;

    if (!settings) {
        return false;
    }

    if (settings.receiveNotifications === false) {
        return false;
    }

    if (settings.notificationWhenUpdateProfile === false) {
        return false;
    }

    return true;
}


export const updateUser: RequestHandler<{ id: string }, UserResponse | { message: string }, Partial<UserResponse>, any> = async (req, res) => {
    try {
        const userId = req.params.id;
        const updatedData = req.body;

        if (!userId) {
            return res.status(400).json({ message: 'Missing userId' }) as any;
        }

        // --- Đọc và cập nhật Users ---
        const usersData = await fs.promises.readFile(userFilePath, 'utf-8');
        let users: UserResponse[] = JSON.parse(usersData);
        const userIndex = users.findIndex(u => u.id === userId);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'User not found' });
        }

        const oldUser = { ...users[userIndex] }; // Copy of old user data
        // Chỉ cập nhật các trường được phép (tránh ghi đè id, createdAt,...)
        // Ví dụ: Cập nhật các trường có trong updatedData
        const userToUpdate = users[userIndex];
        Object.keys(updatedData).forEach(key => {
            if (key in userToUpdate) {
                (userToUpdate as any)[key] = (updatedData as any)[key];
            }
        });
        // Cập nhật updatedAt
        userToUpdate.updatedAt = new Date().toISOString();
        const updatedUser = userToUpdate; // updatedUser bây giờ là user đã được merge

        // --- Xác định các trường thay đổi ---
        const changedFields: string[] = [];
        const relevantFieldsForSync = ['firstName', 'lastName', 'avatar']; // Các trường cần đồng bộ qua conference_details
        let relevantFieldChanged = false;

        if (oldUser.firstName !== updatedUser.firstName) {
            changedFields.push('First Name');
            if (relevantFieldsForSync.includes('firstName')) relevantFieldChanged = true;
        }
        if (oldUser.lastName !== updatedUser.lastName) {
            changedFields.push('Last Name');
            if (relevantFieldsForSync.includes('lastName')) relevantFieldChanged = true;
        }
        if (oldUser.aboutme !== updatedUser.aboutme) changedFields.push("About me");
        if (oldUser.avatar !== updatedUser.avatar) {
            changedFields.push("Avatar");
            if (relevantFieldsForSync.includes('avatar')) relevantFieldChanged = true;
        }
        if (!areArraysEqual(oldUser.interestedTopics, updatedUser.interestedTopics)) changedFields.push("Interested topics");
        if (oldUser.background !== updatedUser.background) changedFields.push("Interests"); // Giả sử đây là tên trường đúng


        // --- Xử lý Notification (chỉ khi thông tin profile thay đổi, không phải setting) ---
        const hasNonSettingChanges = changedFields.length > 0;
        if (hasNonSettingChanges && shouldSendUpdateProfileNotification(updatedUser)) {
            const now = new Date().toISOString();
            let notificationMessage = `Your profile has been updated: ${changedFields.join(', ')} were changed.`;
            const notification: Notification = {
                id: uuidv4(),
                conferenceId: "",
                createdAt: now,
                isImportant: false,
                seenAt: null,
                deletedAt: null,
                message: notificationMessage,
                type: 'Profile Update',
            };

            if (!updatedUser.notifications) {
                updatedUser.notifications = [];
            }
            updatedUser.notifications.unshift(notification); // Thêm vào đầu mảng để mới nhất lên trên

            // Gửi real-time notification
            const userSocket = connectedUsers.get(userId);
            if (userSocket) {
                userSocket.emit('notification', notification);
            }
        }

        // --- Cập nhật user trong mảng users ---
        users[userIndex] = updatedUser;

        // --- Lưu file users_list.json ---
        await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

        // *** BẮT ĐẦU: Cập nhật Conference Details ***
        if (relevantFieldChanged) {
            try {
                const conferenceDetailsData = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
                let conferenceDetails: ConferenceResponse[] = JSON.parse(conferenceDetailsData);
                let conferenceFileNeedsUpdate = false;

                conferenceDetails = conferenceDetails.map(detail => {
                    let followedByUpdated = false;
                    let feedBacksUpdated = false; // Đổi tên biến này cho nhất quán nếu cần

                    // Cập nhật trong followedBy (Giữ nguyên logic này)
                    if (detail.followedBy && detail.followedBy.length > 0) {
                        detail.followedBy = detail.followedBy.map(follower => {
                            if (follower.id === userId) {
                                follower.firstName = updatedUser.firstName;
                                follower.lastName = updatedUser.lastName;
                                follower.avatar = updatedUser.avatar;
                                followedByUpdated = true;
                                // return follower; // Không cần return ở đây nếu bạn đang sửa trực tiếp object
                            }
                            return follower; // Luôn return follower
                        });
                    }

                    // --- Cập nhật trong feedBacks (ĐÃ ĐIỀU CHỈNH) ---
                    // Chỉ kiểm tra và sử dụng key 'feedBacks'
                    if (detail.feedBacks && detail.feedBacks.length > 0) {
                        detail.feedBacks = detail.feedBacks.map(feedback => {
                            if (feedback.creatorId === userId) {
                                feedback.firstName = updatedUser.firstName;
                                feedback.lastName = updatedUser.lastName;
                                feedback.avatar = updatedUser.avatar;
                                // Không cập nhật updatedAt ở đây trừ khi có yêu cầu
                                feedBacksUpdated = true; // Đặt cờ đã cập nhật
                                // return feedback; // Không cần return ở đây nếu bạn đang sửa trực tiếp object
                            }
                            return feedback; // Luôn return feedback
                        });
                    }
                    // --- Kết thúc điều chỉnh feedBacks ---

                    if (followedByUpdated || feedBacksUpdated) {
                        conferenceFileNeedsUpdate = true;
                    }
                    return detail; // Luôn return detail trong map ngoài cùng
                });

                // Chỉ ghi lại file nếu có thay đổi thực sự
                if (conferenceFileNeedsUpdate) {
                    await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferenceDetails, null, 2), 'utf-8');
                    console.log(`Updated user info for ${userId} in conference details.`);
                }

            } catch (confError: any) {
                console.error(`Error updating conference details for user ${userId}:`, confError);
            }
        }
        // *** KẾT THÚC: Cập nhật Conference Details ***

        // --- Trả về thông tin user đã cập nhật ---
        // Loại bỏ password trước khi trả về nếu có
        const { password, ...userResponseData } = updatedUser;
        res.status(200).json(userResponseData as UserResponse); // Cast về UserResponse để đảm bảo type

    } catch (error: any) {
        console.error('Error updating user:', error);
        // Kiểm tra lỗi cụ thể nếu cần (ví dụ: lỗi đọc/ghi file)
        if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'Database file not found.' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};