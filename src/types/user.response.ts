
export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dob?: string; // Optional, as it might not be present in all users
  role: string;
  avatar?: string;
  aboutme?: string;
  interestedTopics?: string[];
  background?: string;
  followedConferences?: Follow[]; // Now an array of objects
  myConferences?: MyConference[]; // Now an array of objects
  calendar?: Calendar[]; // Replace 'any' with a more specific type if you have one
  feedBacks?: string[];
  notifications?: Notification[];
  setting? : Setting;
  createdAt: string;
  updatedAt: string;
}

export type Follow = {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type Calendar = {
  id: string;
  createdAt: string;
  updatedAt: string;
}


export type MyConference = {
  id: string;
  status: string;
  statusTime: string;
  submittedAt: string;
}

export type Notification = {
  id: string;
  createdAt: string;
  isImportant: boolean;
  seenAt: string | null;
  deletedAt: string | null;
  message: string;
  type: string;
}


export type Setting = {
  receiveNotifications?: boolean;
  autoAddFollowToCalendar?: boolean;
  notificationWhenConferencesChanges?: boolean;
  upComingEvent?: boolean;
  notificationThrough?: "System" | "Email" | "All";
  notificationWhenUpdateProfile?: boolean;
  notificationWhenFollow?: boolean;
  notificationWhenAddTocalendar?: boolean;
}