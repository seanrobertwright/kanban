CREATE TABLE custom_field_access_policy (
  field_id INTEGER NOT NULL REFERENCES custom_field(id) ON DELETE CASCADE,
  role workspace_role NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_edit BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(field_id, role)
);
