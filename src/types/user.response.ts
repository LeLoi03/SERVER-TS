
export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dob?: string;
  password?: string;
  role: string;
  avatar: string;
  aboutme?: string;
  interestedTopics?: string[];
  background?: string;
  followedConferences?: Follow[];
  myConferences?: MyConference[];
  calendar?: Calendar[];
  feedBacks?: string[];
  notifications?: Notification[];
  blacklist?: Blacklist[]; // <-- ADD THIS LINE
  setting?: Setting;
  isVerified?: boolean;
  verificationToken?: string | null;
  verificationTokenExpires?: string | null;
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
  conferenceId: string;
  createdAt: string;
  isImportant: boolean;
  seenAt: string | null;
  deletedAt: string | null;
  message: string;
  type: string;
}

export type Blacklist = {
  id: string;
  blacklistedAt: string;
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
  notificationWhenAddToBlacklist?: boolean;
}