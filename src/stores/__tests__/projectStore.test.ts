import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "../projectStore";
import type { Project } from "../../types";

const { mockDb } = await import("../../test/setup");

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: "proj-1",
  name: "Test Project",
  script_text: null,
  output_directory: null,
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [], currentProject: null });
    mockDb.select.mockReset().mockResolvedValue([]);
    mockDb.execute.mockReset().mockResolvedValue({ rowsAffected: 0 });
  });

  describe("loadProjects", () => {
    it("fetches projects from DB and sets state", async () => {
      const projects = [makeProject(), makeProject({ id: "proj-2", name: "Second" })];
      mockDb.select.mockResolvedValueOnce(projects);

      await useProjectStore.getState().loadProjects();

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM projects ORDER BY updated_at DESC"
      );
      expect(useProjectStore.getState().projects).toEqual(projects);
    });

    it("sets empty array when no projects exist", async () => {
      mockDb.select.mockResolvedValueOnce([]);

      await useProjectStore.getState().loadProjects();

      expect(useProjectStore.getState().projects).toEqual([]);
    });
  });

  describe("createProject", () => {
    it("inserts into DB and prepends to projects array", async () => {
      const existing = makeProject({ id: "old-1", name: "Old" });
      useProjectStore.setState({ projects: [existing] });

      const result = await useProjectStore.getState().createProject("New Project");

      expect(result.name).toBe("New Project");
      expect(result.id).toBeDefined();
      expect(result.script_text).toBeNull();
      expect(result.output_directory).toBeNull();
      expect(mockDb.execute).toHaveBeenCalledWith(
        "INSERT INTO projects (id, name, script_text, output_directory, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
        expect.arrayContaining([result.id, "New Project", null, null])
      );
      const { projects } = useProjectStore.getState();
      expect(projects[0].name).toBe("New Project");
      expect(projects[1].id).toBe("old-1");
    });
  });

  describe("loadProject", () => {
    it("loads a project by id and sets currentProject", async () => {
      const project = makeProject();
      mockDb.select.mockResolvedValueOnce([project]);

      await useProjectStore.getState().loadProject("proj-1");

      expect(mockDb.select).toHaveBeenCalledWith(
        "SELECT * FROM projects WHERE id = $1",
        ["proj-1"]
      );
      expect(useProjectStore.getState().currentProject).toEqual(project);
    });

    it("sets currentProject to null when no result found", async () => {
      useProjectStore.setState({ currentProject: makeProject() });
      mockDb.select.mockResolvedValueOnce([]);

      await useProjectStore.getState().loadProject("nonexistent");

      expect(useProjectStore.getState().currentProject).toBeNull();
    });
  });

  describe("updateProject", () => {
    it("builds UPDATE query with single field", async () => {
      const project = makeProject();
      useProjectStore.setState({ projects: [project], currentProject: project });

      await useProjectStore.getState().updateProject("proj-1", { name: "Renamed" });

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE projects SET name = $1, updated_at = $2 WHERE id = $3",
        ["Renamed", expect.any(String), "proj-1"]
      );
      expect(useProjectStore.getState().currentProject?.name).toBe("Renamed");
      expect(useProjectStore.getState().projects[0].name).toBe("Renamed");
    });

    it("builds UPDATE query with multiple fields and correct param indexing", async () => {
      const project = makeProject();
      useProjectStore.setState({ projects: [project], currentProject: project });

      await useProjectStore.getState().updateProject("proj-1", {
        name: "Updated",
        script_text: "My script",
        output_directory: "/output",
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        "UPDATE projects SET name = $1, script_text = $2, output_directory = $3, updated_at = $4 WHERE id = $5",
        ["Updated", "My script", "/output", expect.any(String), "proj-1"]
      );
      const state = useProjectStore.getState();
      expect(state.currentProject?.name).toBe("Updated");
      expect(state.currentProject?.script_text).toBe("My script");
      expect(state.currentProject?.output_directory).toBe("/output");
    });

    it("does not update currentProject if ids do not match", async () => {
      const current = makeProject({ id: "other-id" });
      const listed = makeProject({ id: "proj-1" });
      useProjectStore.setState({ projects: [listed], currentProject: current });

      await useProjectStore.getState().updateProject("proj-1", { name: "Changed" });

      expect(useProjectStore.getState().currentProject?.id).toBe("other-id");
      expect(useProjectStore.getState().currentProject?.name).toBe("Test Project");
    });
  });

  describe("deleteProject", () => {
    it("removes project from DB and state", async () => {
      const p1 = makeProject({ id: "p1" });
      const p2 = makeProject({ id: "p2" });
      useProjectStore.setState({ projects: [p1, p2], currentProject: null });

      await useProjectStore.getState().deleteProject("p1");

      expect(mockDb.execute).toHaveBeenCalledWith(
        "DELETE FROM projects WHERE id = $1",
        ["p1"]
      );
      expect(useProjectStore.getState().projects).toEqual([p2]);
    });

    it("clears currentProject when deleted project is current", async () => {
      const project = makeProject();
      useProjectStore.setState({ projects: [project], currentProject: project });

      await useProjectStore.getState().deleteProject("proj-1");

      expect(useProjectStore.getState().currentProject).toBeNull();
      expect(useProjectStore.getState().projects).toEqual([]);
    });

    it("preserves currentProject when deleting a different project", async () => {
      const current = makeProject({ id: "keep" });
      const other = makeProject({ id: "remove" });
      useProjectStore.setState({ projects: [current, other], currentProject: current });

      await useProjectStore.getState().deleteProject("remove");

      expect(useProjectStore.getState().currentProject?.id).toBe("keep");
    });
  });
});
