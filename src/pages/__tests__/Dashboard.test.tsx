import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Dashboard from "../Dashboard";

const mockNavigate = vi.fn();

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../components/NewProjectDialog", () => ({
  default: () => <div data-testid="new-project-dialog" />,
}));

const mockState = {
  projects: [] as Array<{
    id: string;
    name: string;
    script_text: string | null;
    output_directory: string | null;
    created_at: string;
    updated_at: string;
  }>,
  loadProjects: vi.fn(),
  createProject: vi.fn(),
};

vi.mock("../../stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: typeof mockState) => unknown) =>
    selector(mockState)
  ),
}));

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.projects = [];
  });

  it("renders Projects heading", () => {
    render(<Dashboard />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows empty state when projects array is empty", () => {
    render(<Dashboard />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a project to start building your B-Roll pipeline."
      )
    ).toBeInTheDocument();
  });

  it("shows project cards when projects exist", () => {
    mockState.projects = [
      {
        id: "p1",
        name: "My Video Project",
        script_text: "Some script content here",
        output_directory: null,
        created_at: "2025-01-15T10:00:00Z",
        updated_at: "2025-01-15T10:00:00Z",
      },
      {
        id: "p2",
        name: "Another Project",
        script_text: null,
        output_directory: null,
        created_at: "2025-02-01T12:00:00Z",
        updated_at: "2025-02-01T12:00:00Z",
      },
    ];
    render(<Dashboard />);
    expect(screen.getByText("My Video Project")).toBeInTheDocument();
    expect(screen.getByText("Another Project")).toBeInTheDocument();
    expect(screen.getByText("No script yet")).toBeInTheDocument();
  });

  it("shows New Project button", () => {
    render(<Dashboard />);
    expect(screen.getByText("New Project")).toBeInTheDocument();
  });
});
