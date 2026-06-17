-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "order" INTEGER,
ADD COLUMN     "task_goal_id" TEXT;

-- CreateTable
CREATE TABLE "task_goals" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "tag" VARCHAR(30),
    "target_sessions" INTEGER,
    "deadline" TIMESTAMP(3),
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_goals_user_id_idx" ON "task_goals"("user_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_goal_id_fkey" FOREIGN KEY ("task_goal_id") REFERENCES "task_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_goals" ADD CONSTRAINT "task_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
