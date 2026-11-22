import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export type Role = 'admin' | 'chef' | 'staff';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  role: Role;
  phone?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['admin', 'chef', 'staff'], required: true },
    phone: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

UserSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

// Ensure password is included when we explicitly ask for it via select('+password').
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
