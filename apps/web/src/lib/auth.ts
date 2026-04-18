import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId:     process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    jwt({ token, profile }) {
      // Persist GitHub login (numeric user id) on the token
      if (profile?.id != null) {
        token.providerId = String(profile.id);
      }
      return token;
    },
    session({ session, token }) {
      // Expose a stable userId on the session
      if (token.providerId) {
        session.user.id = token.providerId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
});
