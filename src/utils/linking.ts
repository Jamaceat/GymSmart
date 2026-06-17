import { Linking, Platform } from 'react-native';

/**
 * Extracts the 11-character video ID from a YouTube URL (regular, shorts, youtu.be).
 */
export function extractYoutubeId(url: string): string | null {
  const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|shorts\/|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
}

/**
 * Opens an exercise video URL using a deep link if the corresponding app is installed,
 * otherwise falls back to opening it in the system browser.
 */
export async function openExerciseVideo(url: string) {
  if (!url) return;

  const trimmedUrl = url.trim();

  try {
    if (trimmedUrl.includes('youtube.com') || trimmedUrl.includes('youtu.be')) {
      const videoId = extractYoutubeId(trimmedUrl);
      if (videoId) {
        const deepLink = Platform.select({
          ios: `youtube://www.youtube.com/watch?v=${videoId}`,
          android: `vnd.youtube:${videoId}`,
          default: trimmedUrl,
        });

        const canOpen = await Linking.canOpenURL(deepLink);
        if (canOpen) {
          await Linking.openURL(deepLink);
          return;
        }
      }
    } else if (trimmedUrl.includes('tiktok.com')) {
      // Direct deep link check for TikTok app
      const deepLink = 'tiktok://';
      const canOpen = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(trimmedUrl);
        return;
      }
    } else if (trimmedUrl.includes('instagram.com')) {
      // Direct deep link check for Instagram app
      const deepLink = 'instagram://';
      const canOpen = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(trimmedUrl);
        return;
      }
    }

    // Default web fallback
    await Linking.openURL(trimmedUrl);
  } catch (error) {
    console.error('Error opening video URL:', error);
    // Definitive fallback
    try {
      await Linking.openURL(trimmedUrl);
    } catch (fallbackError) {
      console.error('Final fallback failed:', fallbackError);
    }
  }
}
