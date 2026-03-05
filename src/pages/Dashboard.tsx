import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useProjectStore } from "../stores/projectStore";
import NewProjectDialog from "../components/NewProjectDialog";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9 3v12M3 9h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-neutral-700"
    >
      <rect
        x="6"
        y="10"
        width="36"
        height="28"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="10" y="10" width="4" height="4" stroke="currentColor" strokeWidth="1" />
      <rect x="10" y="34" width="4" height="4" stroke="currentColor" strokeWidth="1" />
      <rect x="34" y="10" width="4" height="4" stroke="currentColor" strokeWidth="1" />
      <rect x="34" y="34" width="4" height="4" stroke="currentColor" strokeWidth="1" />
      <path d="M18 20l10 4-10 4V20z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function Dashboard() {
  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const createProject = useProjectStore((s) => s.createProject);
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreate = async (name: string) => {
    const project = await createProject(name);
    setDialogOpen(false);
    navigate(`/project/${project.id}`);
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Projects</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          <PlusIcon />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <FilmIcon />
          <h2 className="text-lg font-medium text-neutral-300 mt-4">
            No projects yet
          </h2>
          <p className="text-sm text-neutral-500 mt-1 max-w-xs">
            Create a project to start building your B-Roll pipeline.
          </p>
          <button
            onClick={() => setDialogOpen(true)}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            <PlusIcon />
            Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => navigate(`/project/${project.id}`)}
              className="text-left bg-neutral-900 border border-neutral-800 rounded-xl p-5 hover:border-neutral-700 hover:bg-neutral-900/80 transition-colors group"
            >
              <h3 className="text-sm font-semibold text-neutral-100 truncate group-hover:text-white">
                {project.name}
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                {formatDate(project.created_at)}
              </p>
              {project.script_text ? (
                <p className="text-xs text-neutral-600 mt-3 line-clamp-3 leading-relaxed font-mono">
                  {project.script_text.slice(0, 100)}
                  {project.script_text.length > 100 ? "..." : ""}
                </p>
              ) : (
                <p className="text-xs text-neutral-700 mt-3 italic">
                  No script yet
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}
