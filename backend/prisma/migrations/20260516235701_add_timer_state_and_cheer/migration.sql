-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notification_prefs" TEXT;

-- CreateTable
CREATE TABLE "timer_states" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "phase" VARCHAR(20) NOT NULL,
    "phaseType" VARCHAR(20) NOT NULL,
    "remaining_seconds" INTEGER NOT NULL,
    "total_seconds" INTEGER NOT NULL,
    "is_running" BOOLEAN NOT NULL,
    "pomodoro_count" INTEGER NOT NULL DEFAULT 0,
    "task_label" VARCHAR(200),
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timer_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheers" (
    "id" UUID NOT NULL,
    "cheerer_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cheers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "timer_states_user_id_key" ON "timer_states"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cheers_cheerer_id_target_id_key" ON "cheers"("cheerer_id", "target_id");

-- CreateIndex
CREATE INDEX "friendships_requester_id_status_idx" ON "friendships"("requester_id", "status");

-- CreateIndex
CREATE INDEX "friendships_addressee_id_status_idx" ON "friendships"("addressee_id", "status");

-- CreateIndex
CREATE INDEX "goal_progress_user_id_period_start_idx" ON "goal_progress"("user_id", "period_start");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "sessions_user_id_completed_at_idx" ON "sessions"("user_id", "completed_at");

-- AddForeignKey
ALTER TABLE "timer_states" ADD CONSTRAINT "timer_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_cheerer_id_fkey" FOREIGN KEY ("cheerer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheers" ADD CONSTRAINT "cheers_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
