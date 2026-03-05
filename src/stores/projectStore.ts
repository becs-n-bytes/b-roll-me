import { create } from "zustand";
import type { Project } from "../types";
import { getDb } from "../lib/database";

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  loadProject: (id: string) => Promise<void>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,

  loadProjects: async () => {
    const db = await getDb();
    const rows = await db.select<Project[]>(
      "SELECT * FROM projects ORDER BY updated_at DESC"
    );
    set({ projects: rows });
  },

  createProject: async (name: string) => {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(
      "INSERT INTO projects (id, name, script_text, output_directory, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, name, null, null, now, now]
    );
    const project: Project = {
      id,
      name,
      script_text: null,
      output_directory: null,
      created_at: now,
      updated_at: now,
    };
    set((state) => ({ projects: [project, ...state.projects] }));
    return project;
  },

  loadProject: async (id: string) => {
    const db = await getDb();
    const rows = await db.select<Project[]>(
      "SELECT * FROM projects WHERE id = $1",
      [id]
    );
    set({ currentProject: rows[0] ?? null });
  },

  updateProject: async (id: string, updates: Partial<Project>) => {
    const db = await getDb();
    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex}`);
      values.push(updates.name);
      paramIndex++;
    }
    if (updates.script_text !== undefined) {
      fields.push(`script_text = $${paramIndex}`);
      values.push(updates.script_text);
      paramIndex++;
    }
    if (updates.output_directory !== undefined) {
      fields.push(`output_directory = $${paramIndex}`);
      values.push(updates.output_directory);
      paramIndex++;
    }

    fields.push(`updated_at = $${paramIndex}`);
    values.push(now);
    paramIndex++;

    values.push(id);

    await db.execute(
      `UPDATE projects SET ${fields.join(", ")} WHERE id = $${paramIndex}`,
      values
    );

    set((state) => ({
      currentProject:
        state.currentProject?.id === id
          ? { ...state.currentProject, ...updates, updated_at: now }
          : state.currentProject,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...updates, updated_at: now } : p
      ),
    }));
  },

  deleteProject: async (id: string) => {
    const db = await getDb();
    await db.execute("DELETE FROM projects WHERE id = $1", [id]);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProject:
        state.currentProject?.id === id ? null : state.currentProject,
    }));
  },
}));
