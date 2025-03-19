
export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dob?: string; // Optional, as it might not be present in all users
  role: string;
  followedConferences?: FollowedConference[]; // Now an array of objects
  calendar?: any[]; // Replace 'any' with a more specific type if you have one
  feedBacks?: string[];
  createdAt: string;
  updatedAt: string;
}

export type FollowedConference = {
  id: string;
  createdAt: string;
  updatedAt: string;
}


