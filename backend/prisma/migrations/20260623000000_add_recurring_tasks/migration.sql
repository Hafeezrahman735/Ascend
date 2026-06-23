-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "is_recurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_spawned_date" TEXT,
ADD COLUMN     "parent_task_id" TEXT,
ADD COLUMN     "recurring_days" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recurring_streak" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

