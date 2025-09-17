//Import necessary libraries
import { Client } from 'pg';

import { v4 as uuidv4 } from 'uuid';
import * as fs from "fs";
import md5 from 'crypto-js/md5';
import {Id, Base58, ValueOptionsParams, PropertiesParam, RelationsParam, EntityRelationParams, IdUtils} from "@graphprotocol/grc-20";

import { validate as uuidValidate } from 'uuid';




  
export type AttributeInput = {
    attribute_id: string;
    text_value: string | null;
    number_value: number | null;
    boolean_value: boolean | null;
    language_option: string | null;
    format_option: string | null;
    unit_option: string | null;
    value_type: string;
  };


// ----- constants -----
// FUNCTION - Normalize any UUIDs within text values
function normalizeTextValue(text_value: string ) {
  // Normalize geobrowser.io/space/[id1][/id2]
  text_value = text_value.replace(
    /geobrowser\.io\/space\/([\w\d]{21,22})(?:\/([\w\d]{21,22}))?/g,
    (_, id1, id2) => {
      const newId1 = normalizeToUUID_STRING(id1);
      const newId2 = id2 ? "/" + normalizeToUUID_STRING(id2) : "";
      return `geobrowser.io/space/${newId1}${newId2}`;
    }
  );

  // Normalize tabId=
  text_value = text_value.replace(
    /tabId=([\w\d]{21,22})/g,
    (_, tabId) => `tabId=${normalizeToUUID_STRING(tabId)}`
  );

  // Normalize proposalId=
  text_value = text_value.replace(
    /proposalId=([\w\d]{21,22})/g,
    (_, proposalId) => `proposalId=${normalizeToUUID_STRING(proposalId)}`
  );

  // Normalize graph://[ID] (strict, no whitespace allowed)
  text_value = text_value.replace(
    /graph:\/\/([\w\d]{21,22})/g,
    (_, graphId) => `graph://${normalizeToUUID_STRING(graphId)}`
  );

  return text_value;
}

// FUNCTION - Reformat filter and selector to match new spec: https://www.notion.so/Filter-API-1e3273e214eb801b8eb8dc9a9d265b22
type InputFilter = {
  where: {
    spaces?: string[];
    AND?: {
      attribute: string;
      is: string;
    }[];
  };
};

type OutputFilter = Partial<{
  spaceId: { in: string[] };
  filter: Record<string, any>;
}>;

function reformatFilter(inputStr: string): OutputFilter {
  const parsed: InputFilter = JSON.parse(inputStr);

  const output: OutputFilter = {};

  // Handle spaces -> spaceId
  if (parsed.where.spaces && parsed.where.spaces.length > 0) {
    output.spaceId = {
      in: parsed.where.spaces.map(normalizeToUUID_STRING),
    };
  }

  // Mapping of special attribute IDs to their aliases
  const specialAttributeMap: Record<string, string> = {
    "Qx8dASiTNsxxP3rJbd4Lzd": "toEntity",
    "RERshk4JoYoMC17r1qAo9J": "fromEntity",
    "3WxYoAVreE4qFhkDUs5J3q": "type",
  };

  // Separate filters
  const normalFilters: Record<string, { is: string }> = {};
  const relationFilters: Record<string, { is: string }> = {};

  if (parsed.where.AND && parsed.where.AND.length > 0) {
    for (const condition of parsed.where.AND) {
      const attributeUUID = normalizeToUUID_STRING(condition.attribute);
      const valueUUID = normalizeToUUID_STRING(condition.is);

      const alias = specialAttributeMap[condition.attribute];
      if (alias) {
        relationFilters[alias] = { is: valueUUID };
      } else {
        normalFilters[attributeUUID] = { is: valueUUID };
      }
    }

    if (Object.keys(relationFilters).length > 0) {
      output.filter = output.filter || {};
      output.filter["_relation"] = relationFilters;
    }

    if (Object.keys(normalFilters).length > 0) {
      output.filter = output.filter || {};
      Object.assign(output.filter, normalFilters);
    }
  }

  return output;
}

function reformatSelector(input: string): object | string {
  const TO_ENTITY_ID = "Qx8dASiTNsxxP3rJbd4Lzd";
  const FROM_ENTITY_ID = "RERshk4JoYoMC17r1qAo9J";

  // Empty hop like: ->[ENTITY]
  if (/^->\[[^\]]+\]$/.test(input)) {
    return "";
  }

  // Property from an entity: ->[ENTITY]->.[PROPERTY]
  const propMatch = input.match(/->\[(.+?)\]->\.\[(.+?)\]/);
  if (propMatch) {
    const [_, entity, property] = propMatch;
    const propUUID = normalizeToUUID_STRING(property);

    if (entity === TO_ENTITY_ID) {
      return { [propUUID]: {} };
    } else if (entity === FROM_ENTITY_ID) {
      return {
        _relation: {
          from: {
            [propUUID]: {},
          },
        },
      };
    }
  }

  // Relation from an entity: ->[ENTITY]->[RELATION]->[ENTITY]
  const relMatch = input.match(/->\[(.+?)\]->\[(.+?)\]->\[(.+?)\]/);
  if (relMatch) {
    const [_, fromEntity, relation, toEntity] = relMatch;
    const relUUID = normalizeToUUID_STRING(relation);

    if (fromEntity === TO_ENTITY_ID || toEntity === TO_ENTITY_ID) {
      return { [relUUID]: {} };
    }
  }

  // Property from relation entity: .[PROPERTY]
  const relationPropMatch = input.match(/^\.\[(.+?)\]$/);
  if (relationPropMatch) {
    const propUUID = normalizeToUUID_STRING(relationPropMatch[1]);
    return {
      _relation: {
        entity: {
          [propUUID]: {},
        },
      },
    };
  }

  // Relation from relation entity: ->[RELATION]->[ENTITY]
  const relationRelMatch = input.match(/^->\[(.+?)\]->\[(.+?)\]$/);
  if (relationRelMatch) {
    const relUUID = normalizeToUUID_STRING(relationRelMatch[1]);
    return {
      _relation: {
        entity: {
          [relUUID]: {},
        },
      },
    };
  }

  throw new Error(`Unrecognized selector format: ${input}`);
}

// FUNCTION - Migrate IDs
//      Create function to migrate ID's properly
//      Note: We will need to rationalize Relation ID migration. Currently, there is one relation ID, but that will need to be split into 2 (a relation ID and a relationEntity ID)
export function isValid(id: string): boolean {
  if (id.length !== 22 && id.length !== 21) {
    return false;
  }

  try {
    const decoded = Base58.decodeBase58ToUUID(id);
    return uuidValidate(decoded);
  } catch (error) {
    return false;
  }
}

export function deterministicIdFromString(input: string): string {
    // Step 1: Hash input using MD5
    const hash = md5(input).toString(); // 32 hex chars
  
    // Step 2: Format into UUIDv4 style manually
    let uuid = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      '4' + hash.substring(13, 16),            // Set version 4 (UUID v4)
      ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.substring(18, 20), // Set variant
      hash.substring(20, 32)
    ].join('-');
  
    // Step 3: Remove dashes
    return uuid;//.replace(/-/g, '');
  }

export function normalizeToUUID_STRING(id: string): string {
    if (isUUID(id)) {
      return id;
    }
    //const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{22}$/; // Common Base58 UUID format
    //const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{21,22}$/;
  
    if (isValid(id)) {
      try {
        return Base58.decodeBase58ToUUID(id);
      } catch (e) {
        // Fall through if decoding fails
      }
    }
  
    return deterministicIdFromString(id);
  }

export function normalizeToUUID(id: string) {
    return Id(normalizeToUUID_STRING(id))
  }

export function isUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }




// Create relations array
export function createRelationsObjectFromArray(
  relations: {
    id: string;
    type_id: string;
    from_entity_id: string;
    to_entity_id: string;
    to_space_id: string | null;
    index: string;
    space_id: string;
  }[] | undefined | null
): RelationsParam {
  if (!Array.isArray(relations)) {
    console.warn("createRelationsObjectFromArray: input is not an array", relations);
    return {};
  }

  //const output: RelationsParam = {};
  const output: Record<Id | string, Array<EntityRelationParams>> = {};

  relations.forEach(rel => {
    const relationTypeId = normalizeToUUID(rel.type_id);

    const relationObj: EntityRelationParams = {
      id: IdUtils.generate(), // new relation ID
      toEntity: normalizeToUUID(rel.to_entity_id),
      entityId: normalizeToUUID(rel.id),
    };

    if (rel.to_space_id) {
      relationObj.toSpace = normalizeToUUID(rel.to_space_id);
    }

    if (rel.index) {
      relationObj.position = rel.index;
    }

    // Initialize array if needed, then push
    if (!output[relationTypeId]) {
      output[relationTypeId] = [];
    }

    output[relationTypeId].push(relationObj);
  });

  return output;
}




const ValueTypeMap: Record<number, string> = {
  1: "text",
  2: "number",
  3: "checkbox",
  4: "url",
  5: "time",
  6: "point",
};

// Create values array
export function createValuesObjectFromAttributes(
  attributes: AttributeInput[] | undefined | null
): PropertiesParam {
  if (!Array.isArray(attributes)) {
    console.warn("createValuesObjectFromAttributes: input is not an array", attributes);
    return [];
  }

  const result: PropertiesParam = [];

attributes.forEach(attr => {
  const property = normalizeToUUID(attr.attribute_id);
  let valueStr: string | undefined;

  const filter_id = "3YqoLJ7uAPmthXyXmXKoSa";
  const selector_id = '7zvaXnZVY9z5oCoYqciroz';

  if (attr.text_value !== null && attr.text_value !== undefined) {
    try {
      if (attr.attribute_id == filter_id) {
        const normalized_filter = reformatFilter(attr.text_value);
        valueStr = JSON.stringify(normalized_filter);
      } else if (attr.attribute_id == selector_id) {
        const normalized_selector = reformatSelector(attr.text_value);
        if (normalized_selector == "") {
          valueStr = ""
        } else {
          valueStr = JSON.stringify(normalized_selector);
        }
      } else {
        valueStr = normalizeTextValue(attr.text_value);
      }
    } catch {
      valueStr = attr.text_value;
    }
  } else if (attr.number_value !== null && attr.number_value !== undefined) {
    valueStr = attr.number_value.toString();
  } else if (attr.boolean_value !== null && attr.boolean_value !== undefined) {
    valueStr = attr.boolean_value.toString();
  }

  if (valueStr !== undefined) {
    const valueTypeStr = attr.value_type ? ValueTypeMap[attr.value_type] : undefined;

    let includeOptions;
    if ((attr.unit_option) || (attr.language_option)) { //|| (attr.format_option)
      includeOptions = true
    } else {
      includeOptions = false
    }

    let options: ValueOptionsParams | undefined;
    if (valueTypeStr === "number") {
      options = {
        type: "number",
        ...(attr.unit_option ? { unit: normalizeToUUID(attr.unit_option) } : {}),
    //    ...(attr.format_option ? { format: attr.format_option } : {})
      };
    } else if (valueTypeStr === "text") {
      options = {
        type: "text",
        ...(attr.language_option ? { language: attr.language_option } : {})
      };
    } 
    //else if (valueTypeStr === "time") {
    //  options = {
    //    type: "time",
    //    ...(attr.format_option ? { format: attr.format_option } : {}),
    //  };
    //}

    // ✅ THIS is the correct type for a single object in PropertiesParam array
    if (valueStr != "") {
      const entry: PropertiesParam[number] = {
        property,
        value: valueStr,
        ...(includeOptions ? { options } : {})
      };

      result.push(entry); // ✅ No error now
    }
  }

});

return result;

}