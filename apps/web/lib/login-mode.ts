// Google login needs Clerk keys, and a local sandbox has its own throwaway accounts. Without keys
// the app still works: its pages only read the public chain, and every write needs the wallet.
export const loginEnabled = process.env.NEXT_PUBLIC_NETWORK !== 'sandbox' && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
