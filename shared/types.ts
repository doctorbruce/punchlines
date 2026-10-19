export interface QuoteInput {
  speaker: string;
  text: string;
  source: string;
  tag: string;
  saidAt: string;
}

export interface Quote extends QuoteInput {
  id: string;
  imageUrl: string | null;
  createdAt: number;
}

export interface Person {
  name: string;
  count: number;
}

export interface ArchiveMeta {
  people: Person[];
  total: number;
  images: number;
}

export interface QuotePage {
  quotes: Quote[];
  total: number;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
}

export interface Account extends SessionUser {
  isActive: boolean;
  createdAt: number;
}

export interface QuoteComment {
  id: string;
  userId: string;
  authorName: string;
  text: string;
  createdAt: number;
}

export interface CommentPage {
  comments: QuoteComment[];
  total: number;
}
