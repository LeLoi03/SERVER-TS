import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { ConferenceResponse } from '../types/conference.response';


const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// 1. Lấy Conference theo ID
export const getConferenceById: RequestHandler<{ id: string }, ConferenceResponse | { message: string }, any, any> = async (
  req,
  res
): Promise<void> => {
  const conferenceId = req.params.id;
  // console.log("Receive:", conferenceId)
  try {
    const data = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
    const conferences: ConferenceResponse[] = JSON.parse(data); // Đổi kiểu này


    // Tìm conference theo ID
    const foundConference = conferences.find(c => c.conference.id === conferenceId);

    if (!foundConference) {
      res.status(404).json({ message: 'Conference not found' });
      return;
    }

    // Chuyển đổi ngày tháng (nếu cần)
    // Lưu ý: Chỉ chuyển đổi nếu bạn *thực sự* cần Date object ở backend.
    // Nếu bạn chỉ cần string ISO, bạn có thể bỏ qua phần này.
    if (foundConference.dates && foundConference.dates.length > 0) {
      foundConference.dates.forEach(date => {
        if (date?.fromDate) {
          date.fromDate = new Date(date?.fromDate).toISOString();
        }
        if (date?.toDate) {
          date.toDate = new Date(date?.toDate).toISOString();
        }
      });
    }
    console.log("success");
    // Trả về toàn bộ ConferenceResponse
    res.status(200).json(foundConference);
    return;

  } catch (error: any) {
    console.error('Error reading or processing conference data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in conference-list.json' });
      return;
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'conference-list.json not found' });
      return;
    } else {
      res.status(500).json({ message: 'Internal server error' });
      return;
    }
  }
};