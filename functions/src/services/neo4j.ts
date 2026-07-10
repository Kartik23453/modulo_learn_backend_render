import neo4j, { Driver } from "neo4j-driver";
import { getNeo4jConfig } from "../config.js";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (driver) return driver;

  const config = getNeo4jConfig();

  if (!config.uri || !config.user || !config.password) {
    throw new Error("Neo4j AuraDB credentials not configured in .env");
  }

  driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
    maxConnectionPoolSize: 10,
    connectionTimeout: 30000,
  });

  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function createCourse(course: {
  id: string;
  title: string;
  metadata: string;
  thumbnail: string;
  lectures: { id: string; title: string; duration: number }[];
}): Promise<void> {
  const d = getDriver();
  const session = d.session();

  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MERGE (c:Course {id: $courseId})
         ON CREATE SET c.title = $title, c.metadata = $metadata, c.thumbnail = $thumbnail
         WITH c
         UNWIND $lectures AS lec
         MERGE (l:Lecture {id: lec.id})
         ON CREATE SET l.title = lec.title, l.duration = lec.duration
         MERGE (c)-[:CONTAINS]->(l)`,
        {
          courseId: course.id,
          title: course.title,
          metadata: course.metadata,
          thumbnail: course.thumbnail,
          lectures: course.lectures,
        }
      )
    );
  } finally {
    await session.close();
  }
}

export async function enrollUser(
  userId: string,
  courseId: string,
  deadline: string
): Promise<void> {
  const d = getDriver();
  const session = d.session();

  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MERGE (u:User {id: $userId})
         ON CREATE SET u.id = $userId
         WITH u
         MATCH (c:Course {id: $courseId})
         MERGE (u)-[e:ENROLLED_IN]->(c)
         SET e.deadline = $deadline`,
        { userId, courseId, deadline }
      )
    );
  } finally {
    await session.close();
  }
}

export async function completeLecture(
  userId: string,
  lectureId: string
): Promise<void> {
  const d = getDriver();
  const session = d.session();

  try {
    await session.executeWrite((tx) =>
      tx.run(
        `MERGE (u:User {id: $userId})
         ON CREATE SET u.id = $userId
         WITH u
         MATCH (l:Lecture {id: $lectureId})
         MERGE (u)-[:COMPLETED]->(l)`,
        { userId, lectureId }
      )
    );
  } finally {
    await session.close();
  }
}

export async function getCourseProgress(
  userId: string,
  courseId: string
): Promise<{
  courseTitle: string;
  totalLectures: number;
  completedLectures: number;
  percentage: number;
  deadline: string | null;
  thumbnail: string | null;
}> {
  const d = getDriver();
  const session = d.session();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (u:User {id: $userId})-[e:ENROLLED_IN]->(c:Course {id: $courseId})
         MATCH (c)-[:CONTAINS]->(l:Lecture)
         OPTIONAL MATCH (u)-[comp:COMPLETED]->(l)
         RETURN c.title AS courseTitle,
                c.thumbnail AS thumbnail,
                COUNT(l) AS totalLectures,
                COUNT(comp) AS completedLectures,
                e.deadline AS deadline`,
        { userId, courseId }
      )
    );

    if (result.records.length === 0) {
      throw new Error("User is not enrolled in this course");
    }

    const record = result.records[0];
    const total = record.get("totalLectures").toNumber();
    const completed = record.get("completedLectures").toNumber();

    return {
      courseTitle: record.get("courseTitle"),
      thumbnail: record.get("thumbnail") || null,
      totalLectures: total,
      completedLectures: completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      deadline: record.get("deadline"),
    };
  } finally {
    await session.close();
  }
}

export async function getUserCourses(userId: string): Promise<
  {
    courseId: string;
    courseTitle: string;
    totalLectures: number;
    completedLectures: number;
    percentage: number;
    deadline: string | null;
    thumbnail: string | null;
  }[]
> {
  const d = getDriver();
  const session = d.session();

  try {
    const result = await session.executeRead((tx) =>
      tx.run(
        `MATCH (u:User {id: $userId})-[e:ENROLLED_IN]->(c:Course)
         MATCH (c)-[:CONTAINS]->(l:Lecture)
         OPTIONAL MATCH (u)-[comp:COMPLETED]->(l)
         RETURN c.id AS courseId,
                c.title AS courseTitle,
                c.thumbnail AS thumbnail,
                COUNT(l) AS totalLectures,
                COUNT(comp) AS completedLectures,
                e.deadline AS deadline`,
        { userId }
      )
    );

    return result.records.map((record) => {
      const total = record.get("totalLectures").toNumber();
      const completed = record.get("completedLectures").toNumber();
      return {
        courseId: record.get("courseId"),
        courseTitle: record.get("courseTitle"),
        thumbnail: record.get("thumbnail") || null,
        totalLectures: total,
        completedLectures: completed,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
        deadline: record.get("deadline"),
      };
    });
  } finally {
    await session.close();
  }
}
