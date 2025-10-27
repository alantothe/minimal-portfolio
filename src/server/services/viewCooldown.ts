/**
 * View cooldown service to prevent spam view counting
 * Tracks recently incremented posts with timestamps
 * Only allows one view per post per 30 seconds per IP
 */

interface ViewCooldown {
  [postSlug: string]: {
    timestamp: number;
    ip: string;
  };
}

// In-memory store for cooldown tracking (resets on server restart)
const viewCooldowns: ViewCooldown = {};
const COOLDOWN_SECONDS = 30;

/**
 * Check if a post view should be counted based on IP and cooldown
 * Returns true if view should be counted, false if in cooldown
 */
export function shouldCountView(slug: string, ipAddress: string): boolean {
  const now = Date.now();
  const key = slug;

  if (viewCooldowns[key]) {
    const lastViewTime = viewCooldowns[key].timestamp;
    const timeSinceLastView = (now - lastViewTime) / 1000; // Convert to seconds

    // Same IP within cooldown period - don't count
    if (timeSinceLastView < COOLDOWN_SECONDS && viewCooldowns[key].ip === ipAddress) {
      return false;
    }
  }

  // Update cooldown tracking
  viewCooldowns[key] = {
    timestamp: now,
    ip: ipAddress,
  };

  return true;
}

