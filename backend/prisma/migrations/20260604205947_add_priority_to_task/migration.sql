/*
  Warnings:

  - The primary key for the `achievements` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `condition_type` on the `achievements` table. All the data in the column will be lost.
  - You are about to drop the column `condition_value` on the `achievements` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `achievements` table. All the data in the column will be lost.
  - The primary key for the `user_achievements` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `cheers` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[key]` on the table `achievements` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[client_session_id]` on the table `sessions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `category` to the `achievements` table without a default value. This is not possible if the table is not empty.
  - Added the required column `key` to the `achievements` table without a default value. This is not possible if the table is not empty.
  - Added the required column `threshold` to the `achievements` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AchievementCategory" AS ENUM ('STREAK', 'SESSIONS', 'FOCUS_TIME', 'LEVEL', 'TASKS');

-- DropForeignKey
ALTER TABLE "cheers" DROP CONSTRAINT "cheers_cheerer_id_fkey";

-- DropForeignKey
ALTER TABLE "cheers" DROP CONSTRAINT "cheers_target_id_fkey";

-- DropForeignKey
ALTER TABLE "user_achievements" DROP CONSTRAINT "user_achievements_achievement_id_fkey";

-- DropIndex
DROP INDEX "achievements_slug_key";

-- AlterTable
ALTER TABLE "achievements" DROP CONSTRAINT "achievements_pkey",
DROP COLUMN "condition_type",
DROP COLUMN "condition_value",
DROP COLUMN "slug",
ADD COLUMN     "category" "AchievementCategory" NOT NULL,
ADD COLUMN     "key" VARCHAR(100) NOT NULL,
ADD COLUMN     "threshold" INTEGER NOT NULL,
ADD COLUMN     "xpReward" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "achievements_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "client_session_id" VARCHAR(36),
ADD COLUMN     "planned_duration_seconds" INTEGER,
ADD COLUMN     "task_id" TEXT;

-- AlterTable
ALTER TABLE "user_achievements" DROP CONSTRAINT "user_achievements_pkey",
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "achievement_id" SET DATA TYPE TEXT,
ADD CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "current_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_active_date" TIMESTAMP(3),
ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "longest_streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_focus_time" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_sessions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "cheers";

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimated_minutes" INTEGER,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'medium',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "sessions_on_task" INTEGER NOT NULL DEFAULT 0,
    "total_time_on_task" INTEGER NOT NULL DEFAULT 0,
    "session_dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_events" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(30) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_user_id_idx" ON "tasks"("user_id");

-- CreateIndex
CREATE INDEX "feed_events_user_id_created_at_idx" ON "feed_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_key_key" ON "achievements"("key");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_client_session_id_key" ON "sessions"("client_session_id");

-- CreateIndex
CREATE INDEX "sessions_task_id_idx" ON "sessions"("task_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
