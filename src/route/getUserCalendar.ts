import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { CalendarEvent } from '../types/calendar';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '.../database/DB_details.json');



export const getUserCalendar: RequestHandler = async (req, res) => {
    console.log(`[START] getUserCalendar for user ID: ${req.params.id}`); // Bắt đầu request
    try {
        const userId = req.params.id;
        console.log(`[1] userId: ${userId}`);

        if (!userId) {
            console.log('[ERROR] Missing userId');
            return res.status(400).json({ message: 'Missing userId' }) as any;
        }

        let users: UserResponse[] = [];
        try {
            const userData = await fs.promises.readFile(userFilePath, 'utf-8');
            users = JSON.parse(userData);
            console.log(`[2] Users loaded from file. Number of users: ${users.length}`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error("[ERROR] Error reading or parsing users_list.json:", error);
                return res.status(500).json({ message: 'Error reading or parsing user data' });
            }
            console.log('[2] users_list.json not found or empty.  Continuing with empty users array.');
        }

        const user = users.find(u => u.id === userId);
        console.log(`[3] User found (or not): ${user ? 'Yes' : 'No'}`);

        if (!user) {
            console.log(`[ERROR] User not found for ID: ${userId}`);
            return res.status(404).json({ message: 'User not found' });
        }

        if (!user.calendar || user.calendar.length === 0) {
            console.log(`[4] User has no calendar entries.`);
            return res.status(200).json([]); // Trả về mảng rỗng, không phải lỗi
        }

        const calendarIds = user.calendar.map(item => item.id);
        console.log(`[5] Calendar IDs for user: ${calendarIds.join(', ')}`);

        let detailsConferences: ConferenceResponse[] = [];
        try {
            const detailsData = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
            detailsConferences = JSON.parse(detailsData);
            console.log(`[6] Conference details loaded. Number of conferences: ${detailsConferences.length}`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error("[ERROR] Error reading or parsing conference_details_list.json:", error);
                return res.status(500).json({ message: "Error reading or parsing details conference data." });
            }
            console.log('[6] conference_details_list.json not found or empty. Continuing with empty array.');
        }

        if (detailsConferences.length === 0) {
            console.log('[7] No conference details found.');
            return res.status(200).json([]);
        }

        const allConferences = detailsConferences.map(c => ({
            id: c.conference.id,
            title: c.conference.title || "No Title", // Handle null titles
            dates: c.dates || [],
        }));
        console.log(`[8] allConferences (mapped):`, allConferences);

        const calendar = allConferences.filter(conf => calendarIds.includes(conf.id));
        console.log(`[9] Filtered conferences (calendar):`, calendar);

        if (calendar.length === 0) {
            console.log('[10] No matching conferences found in user calendar.');
            return res.status(200).json([]);
        }

        const calendarEvents: CalendarEvent[] = [];

        calendar.forEach(conf => {
            console.log(`[11] Processing conference: ${conf.title} (ID: ${conf.id})`);
            if (conf.dates) {
                conf.dates.forEach(date => {
                    console.log(`[12] Processing date:`, date);
                    // Check for null values on date properties
                    if (date && date.fromDate && date.toDate) {
                        const fromDate = new Date(date.fromDate);
                        const toDate = new Date(date.toDate);

                        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
                            console.error(`[ERROR] Invalid date format for conference ${conf.id}, date:`, date);
                            return;
                        }

                        const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        console.log(`[13] Date difference in days: ${diffDays}`);

                        if (diffDays > 0) {
                            for (let i = 0; i <= diffDays; i++) {
                                const currentDate = new Date(fromDate);
                                currentDate.setDate(fromDate.getDate() + i);
                                console.log(`[14] Adding event for date: ${currentDate.toLocaleDateString()}`);
                                calendarEvents.push({
                                    day: currentDate.getDate(),
                                    month: currentDate.getMonth() + 1,
                                    year: currentDate.getFullYear(),
                                    type: date.type, // Already handled null type in interface
                                    conference: conf.title,
                                    conferenceId: conf.id,
                                });
                            }
                        } else {
                            console.log(`[14] Adding single-day event for date: ${fromDate.toLocaleDateString()}`);
                            calendarEvents.push({
                                day: fromDate.getDate(),
                                month: fromDate.getMonth() + 1,
                                year: fromDate.getFullYear(),
                                type: date.type, // Already handled null type in interface
                                conference: conf.title,
                                conferenceId: conf.id,
                            });
                        }
                    } else {
                        console.warn(`[WARN] Skipping date for conference ${conf.id} due to missing fromDate or toDate`);
                    }
                });
            } else {
                console.warn(`[WARN] Skipping conference ${conf.id} due to missing dates`);
            }
        });

        console.log('[15] Final calendarEvents:', calendarEvents);
        return res.status(200).json(calendarEvents);

    } catch (error: any) {
        console.error('[ERROR] Error fetching calendar events:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
