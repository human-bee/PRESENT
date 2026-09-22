export class RoomError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const validRoomId = (id: string) => /^[a-f0-9]{24,64}$/.test(id);
