import { Router, Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import {
  createCourse,
  enrollUser,
  completeLecture,
  getCourseProgress,
  getUserCourses,
} from "../services/neo4j.js";

const router = Router();

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    (req as any).userId = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.post("/courses", requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, metadata, lectures } = req.body;

    if (!title || !lectures?.length) {
      res.status(400).json({ error: "title and lectures[] are required" });
      return;
    }

    const courseId = `course_${Date.now()}`;
    const lecturesWithIds = lectures.map((l: any, i: number) => ({
      id: `lecture_${courseId}_${i}`,
      title: l.title,
      duration: l.duration || 0,
    }));

    await createCourse({
      id: courseId,
      title,
      metadata: metadata || "",
      lectures: lecturesWithIds,
    });

    res.status(201).json({
      message: "Course created",
      courseId,
      title,
      lectures: lecturesWithIds.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/courses/:courseId/enroll", requireAuth, async (req: Request, res: Response) => {
  try {
    const courseId = req.params.courseId as string;
    const { deadline } = req.body;
    const userId = (req as any).userId;

    if (!deadline) {
      res.status(400).json({ error: "deadline (ISO date) is required" });
      return;
    }

    await enrollUser(userId, courseId, deadline);

    res.status(200).json({
      message: "Enrolled successfully",
      courseId,
      deadline,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post(
  "/courses/:courseId/lectures/:lectureId/complete",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const lectureId = req.params.lectureId as string;
      const userId = (req as any).userId;

      await completeLecture(userId, lectureId);

      res.status(200).json({ message: "Lecture marked as completed" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.get("/courses/:courseId/progress", requireAuth, async (req: Request, res: Response) => {
  try {
    const courseId = req.params.courseId as string;
    const userId = (req as any).userId;

    const progress = await getCourseProgress(userId, courseId);

    res.json(progress);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/courses", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const courses = await getUserCourses(userId);
    res.json(courses);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
