import './AssigneeAvatar.css';

export interface Assignee {
  name: string;
  /** Each person picks an avatar color in their profile; it arrives from the user service. */
  color: string;
}

export function AssigneeAvatar({ assignee }: { assignee: Assignee }) {
  const initials = assignee.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);
  return (
    <span className="assignee-avatar" style={{ backgroundColor: assignee.color }} title={assignee.name} aria-label={assignee.name}>
      {initials}
    </span>
  );
}
