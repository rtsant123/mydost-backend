-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'starter', 'pro');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('scheduled', 'live', 'finished');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('A', 'D', 'B');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "ChatTopic" AS ENUM ('sports', 'teer', 'astrology', 'dost');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "plan" "PlanTier" NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPrefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "interestsJson" JSONB NOT NULL,
    "favoritesJson" JSONB,
    "responseStyle" TEXT NOT NULL DEFAULT 'short',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPrefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "teamA" TEXT NOT NULL,
    "teamB" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'scheduled',
    "source" TEXT,
    "sourceId" TEXT,
    "venue" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "statusText" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchBrief" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sourcesJson" JSONB NOT NULL,
    "briefJson" JSONB NOT NULL,
    "embedding" vector,

    CONSTRAINT "MatchBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRecap" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcesJson" JSONB NOT NULL,
    "recapJson" JSONB NOT NULL,
    "embedding" vector,

    CONSTRAINT "MatchRecap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteAggregate" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "aPct" DOUBLE PRECISION NOT NULL,
    "dPct" DOUBLE PRECISION NOT NULL,
    "bPct" DOUBLE PRECISION NOT NULL,
    "totalVotes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoteAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeerResult" (
    "id" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "r1" INTEGER NOT NULL,
    "r2" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeerResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeerSummary" (
    "id" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summaryJson" JSONB NOT NULL,
    "embedding" vector,

    CONSTRAINT "TeerSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" "ChatTopic" NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "cardsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenEstimate" INTEGER NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserPrefs_userId_key" ON "UserPrefs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_source_sourceId_key" ON "Match"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchBrief_matchId_version_key" ON "MatchBrief"("matchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_matchId_userId_key" ON "Vote"("matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteAggregate_matchId_key" ON "VoteAggregate"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "TeerResult_house_date_key" ON "TeerResult"("house", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TeerSummary_house_windowDays_key" ON "TeerSummary"("house", "windowDays");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_userId_dateKey_key" ON "UsageMetric"("userId", "dateKey");

-- AddForeignKey
ALTER TABLE "UserPrefs" ADD CONSTRAINT "UserPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchBrief" ADD CONSTRAINT "MatchBrief_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRecap" ADD CONSTRAINT "MatchRecap_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteAggregate" ADD CONSTRAINT "VoteAggregate_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
