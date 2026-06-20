-- CreateIndex
CREATE INDEX "goal_progress_goal_id_period_start_idx" ON "goal_progress"("goal_id", "period_start");

-- CreateIndex
CREATE INDEX "sessions_type_completed_at_idx" ON "sessions"("type", "completed_at");
