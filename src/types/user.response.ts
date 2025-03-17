import { ConferenceResponse } from "./conference.response";

export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dob: string; 
  role: "user" | "admin" | string; 
  followedConferences: string[];
  calendar: string[];
  createdAt: string; 
  updatedAt: string; 
}

