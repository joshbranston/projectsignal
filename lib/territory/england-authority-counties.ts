export type EnglandCountySlug =
  | "bedfordshire"
  | "berkshire"
  | "bristol"
  | "buckinghamshire"
  | "cambridgeshire"
  | "cheshire"
  | "city-of-london"
  | "cornwall"
  | "cumbria"
  | "derbyshire"
  | "devon"
  | "dorset"
  | "durham"
  | "east-riding-of-yorkshire"
  | "east-sussex"
  | "essex"
  | "gloucestershire"
  | "greater-london"
  | "greater-manchester"
  | "hampshire"
  | "herefordshire"
  | "hertfordshire"
  | "isle-of-wight"
  | "kent"
  | "lancashire"
  | "leicestershire"
  | "lincolnshire"
  | "merseyside"
  | "norfolk"
  | "north-yorkshire"
  | "northamptonshire"
  | "northumberland"
  | "nottinghamshire"
  | "oxfordshire"
  | "rutland"
  | "shropshire"
  | "somerset"
  | "south-yorkshire"
  | "staffordshire"
  | "suffolk"
  | "surrey"
  | "tyne-and-wear"
  | "warwickshire"
  | "west-midlands"
  | "west-sussex"
  | "west-yorkshire"
  | "wiltshire"
  | "worcestershire";

type CountyRange = readonly [start: number, end: number, county: EnglandCountySlug];

const SINGLE_COUNTY_RANGES: readonly CountyRange[] = [
  [626001, 626003, "durham"],
  [626004, 626004, "north-yorkshire"],
  [626005, 626005, "northumberland"],
  [626006, 626006, "north-yorkshire"],
  [626008, 626012, "tyne-and-wear"],
  [626013, 626014, "lancashire"],
  [626015, 626018, "cheshire"],
  [626019, 626024, "cumbria"],
  [626025, 626034, "greater-manchester"],
  [626035, 626046, "lancashire"],
  [626047, 626051, "merseyside"],
  [626052, 626053, "east-riding-of-yorkshire"],
  [626054, 626055, "lincolnshire"],
  [626056, 626063, "north-yorkshire"],
  [626064, 626067, "south-yorkshire"],
  [626068, 626072, "west-yorkshire"],
  [626073, 626073, "derbyshire"],
  [626074, 626074, "leicestershire"],
  [626075, 626075, "nottinghamshire"],
  [626076, 626076, "rutland"],
  [626077, 626084, "derbyshire"],
  [626085, 626091, "leicestershire"],
  [626092, 626098, "lincolnshire"],
  [626099, 626105, "northamptonshire"],
  [626106, 626112, "nottinghamshire"],
  [626113, 626113, "herefordshire"],
  [626114, 626114, "shropshire"],
  [626115, 626115, "staffordshire"],
  [626116, 626116, "shropshire"],
  [626117, 626124, "staffordshire"],
  [626125, 626129, "warwickshire"],
  [626130, 626136, "west-midlands"],
  [626137, 626142, "worcestershire"],
  [626143, 626145, "bedfordshire"],
  [626146, 626146, "cambridgeshire"],
  [626147, 626148, "essex"],
  [626149, 626153, "cambridgeshire"],
  [626154, 626165, "essex"],
  [626166, 626175, "hertfordshire"],
  [626176, 626182, "norfolk"],
  [626183, 626187, "suffolk"],
  [626188, 626188, "greater-london"],
  [626189, 626189, "city-of-london"],
  [626190, 626220, "greater-london"],
  [626221, 626221, "berkshire"],
  [626222, 626222, "east-sussex"],
  [626223, 626223, "isle-of-wight"],
  [626224, 626224, "kent"],
  [626225, 626225, "buckinghamshire"],
  [626226, 626226, "hampshire"],
  [626227, 626228, "berkshire"],
  [626229, 626229, "hampshire"],
  [626230, 626232, "berkshire"],
  [626233, 626236, "buckinghamshire"],
  [626237, 626241, "east-sussex"],
  [626242, 626252, "hampshire"],
  [626253, 626264, "kent"],
  [626265, 626269, "oxfordshire"],
  [626270, 626280, "surrey"],
  [626281, 626287, "west-sussex"],
  [626288, 626288, "somerset"],
  [626289, 626289, "dorset"],
  [626290, 626290, "bristol"],
  [626291, 626291, "cornwall"],
  [626292, 626292, "dorset"],
  [626293, 626293, "cornwall"],
  [626294, 626294, "somerset"],
  [626295, 626295, "devon"],
  [626296, 626296, "gloucestershire"],
  [626297, 626297, "wiltshire"],
  [626298, 626298, "devon"],
  [626299, 626299, "wiltshire"],
  [626300, 626307, "devon"],
  [626308, 626313, "gloucestershire"],
  [626314, 626318, "somerset"],
  [626320, 626320, "cumbria"],
  [626321, 626321, "hampshire"],
  [626322, 626322, "north-yorkshire"],
  [626323, 626323, "northumberland"],
  [626328, 626328, "kent"],
  [626329, 626330, "greater-london"],
  [626331, 626331, "buckinghamshire"],
  [626332, 626333, "northamptonshire"],
  [626334, 626335, "cumbria"],
  [626336, 626336, "north-yorkshire"],
  [626337, 626337, "somerset"]
];

const MULTI_COUNTY_AUTHORITIES: Readonly<Record<number, readonly EnglandCountySlug[]>> = {
  626007: ["durham", "north-yorkshire"],
  626319: ["devon", "somerset"],
  626324: [
    "cheshire",
    "derbyshire",
    "greater-manchester",
    "south-yorkshire",
    "staffordshire",
    "west-yorkshire"
  ],
  626325: ["east-sussex", "hampshire", "west-sussex"],
  626326: ["norfolk", "suffolk"],
  626327: ["cumbria", "lancashire", "north-yorkshire"]
};

export function allEnglandPlanningDataEntities(): number[] {
  return Array.from({ length: 337 }, (_, index) => 626001 + index);
}

export function countySlugsForPlanningDataEntity(entity: number): EnglandCountySlug[] {
  const multiple = MULTI_COUNTY_AUTHORITIES[entity];
  if (multiple) return [...multiple];

  const range = SINGLE_COUNTY_RANGES.find(([start, end]) => entity >= start && entity <= end);
  return range ? [range[2]] : [];
}

export function buildEnglandAuthorityCountyMappings() {
  return allEnglandPlanningDataEntities().flatMap((planningDataEntity) =>
    countySlugsForPlanningDataEntity(planningDataEntity).map((countySlug) => ({
      planningDataEntity,
      countySlug
    }))
  );
}
