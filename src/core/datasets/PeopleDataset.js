const toPoint = (value = {}) => {
  if (Array.isArray(value)) {
    return { x: Number(value[0]) || 0, y: Number(value[1]) || 0, z: Number(value[2]) || 0 };
  }
  return {
    x: Number(value.x ?? value.X ?? value[0]) || 0,
    y: Number(value.y ?? value.Y ?? value[1]) || 0,
    z: Number(value.z ?? value.Z ?? value[2]) || 0
  };
};

const normalizeAnchor = (person = {}) => {
  const anchor = person.roadwayAnchor || {};
  const edgeId = anchor.edgeId ?? person.edgeId ?? person.roadwayEdgeId ?? null;
  const nodeId = anchor.nodeId ?? person.nodeId ?? person.roadwayNodeId ?? null;
  const ratioValue = anchor.ratio ?? person.ratio ?? null;
  return {
    type: anchor.type || (nodeId ? 'node' : edgeId ? 'edge' : null),
    edgeId: edgeId == null || edgeId === '' ? null : String(edgeId),
    nodeId: nodeId == null || nodeId === '' ? null : String(nodeId),
    ratio: ratioValue == null || ratioValue === '' ? null : Number(ratioValue)
  };
};

function normalizePerson(person, index) {
  const position = toPoint(person.position ?? person);
  const roadwayAnchor = normalizeAnchor(person);
  const id = person.personId ?? person.person_id ?? person.id ?? `P_${String(index + 1).padStart(3, '0')}`;
  return {
    ...person,
    id: String(id),
    personId: String(id),
    label: person.label ?? person.name ?? `Person ${index + 1}`,
    personType: person.personType ?? person.type ?? 'worker',
    team: person.team ?? person.group ?? '',
    status: person.status ?? 'unknown',
    timestamp: person.timestamp ?? person.time ?? null,
    position,
    x: position.x,
    y: position.y,
    z: position.z,
    roadwayAnchor,
    edgeId: roadwayAnchor.edgeId,
    nodeId: roadwayAnchor.nodeId,
    ratio: roadwayAnchor.ratio,
    idx: index
  };
}

export class PeopleDataset {
  constructor({
    people = [],
    source = null,
    peoplePath = source?.peoplePath ?? null,
    contract = null,
    templates = null,
    roleMapping = {},
    validation = null,
    adaptorResults = null
  } = {}) {
    this.type = 'PeopleDataset';
    this.contract = contract;
    this.semanticClass = contract?.class ?? 'People';
    this.templates = templates ?? {};
    this.roleMapping = roleMapping;
    this.validation = validation ?? { valid: true, warnings: [], errors: [], summary: {} };
    this.adaptorResults = adaptorResults;
    this.source = source ?? { peoplePath };
    this.peoplePath = peoplePath;
    this.people = people.map(normalizePerson);
    this.personMap = new Map(this.people.map((person) => [person.personId, person]));
  }

  listPeople() {
    return this.people;
  }

  listPersonIDs() {
    return this.people.map((person) => person.personId);
  }

  getPerson(personId) {
    return this.personMap.get(String(personId)) ?? null;
  }

  getPersonPosition(personId) {
    return this.getPerson(personId)?.position ?? null;
  }

  getPersonState(personId) {
    const person = this.getPerson(personId);
    return person
      ? {
          personId: person.personId,
          status: person.status,
          timestamp: person.timestamp,
          team: person.team,
          personType: person.personType
        }
      : null;
  }

  getRoadwayAnchor(personId) {
    return this.getPerson(personId)?.roadwayAnchor ?? null;
  }

  getPeopleByStatus(status) {
    const target = String(status).toLowerCase();
    return this.people.filter((person) => String(person.status).toLowerCase() === target);
  }

  getPeopleOnRoadwayEdge(edgeId) {
    const target = String(edgeId);
    return this.people.filter((person) => person.roadwayAnchor?.edgeId === target);
  }
}
