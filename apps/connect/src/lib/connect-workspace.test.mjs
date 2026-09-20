import assert from "node:assert/strict";
import test from "node:test";
import { isPeopleWorkspace, isWorkforceWorkspace } from "./connect-workspace.ts";

test("an explicit workspace always wins over a legacy profile type", () => {
  const managingPartner = { profileType: "contractor", workspace: "people" };
  const deliveryAssociate = { profileType: "contractor", workspace: "workforce" };
  assert.equal(isPeopleWorkspace(managingPartner), true);
  assert.equal(isWorkforceWorkspace(managingPartner), false);
  assert.equal(isWorkforceWorkspace(deliveryAssociate), true);
});

test("legacy records retain their historical fallback until they are classified", () => {
  assert.equal(isPeopleWorkspace({ profileType: "employee" }), true);
  assert.equal(isPeopleWorkspace({ profileType: "user" }), true);
  assert.equal(isWorkforceWorkspace({ profileType: "workforce" }), true);
});
