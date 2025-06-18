/**
 * Canvas Share Zone component for the Next.js application.
 * 
 * This component serves as a share zone for the canvas.
 * It includes:
 * - A link to the my canvases page
 * - A user info display
 * - A sign out button
 */

"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, FolderOpen, User } from "lucide-react";

export function CanvasShareZone() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/auth/signin");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* My Canvases Link */}
      <Link
        href="/canvases"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white/90 backdrop-blur-sm rounded-md hover:bg-gray-100 transition-colors"
        title="My Canvases"
      >
        <FolderOpen className="w-4 h-4" />
        My Canvases
      </Link>
      
      {/* User Info */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-md">
        <User className="w-4 h-4 text-gray-600" />
        <span className="text-sm text-gray-700">
          {user.user_metadata?.full_name || user.email}
        </span>
      </div>
      
      {/* Sign Out Button */}
      <button
        onClick={handleSignOut}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white/90 backdrop-blur-sm rounded-md hover:bg-gray-100 transition-colors"
        title="Sign out"
      >
        <LogOut className="w-4 h-4" />
        Sign out
      </button>
    </div>
  );
} 