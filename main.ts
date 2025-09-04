//Import necessary libraries
import { Client } from 'pg';
import * as fs from "fs";
import { DataType, Graph, Op, Position} from "@graphprotocol/grc-20";
import { createRelationsObjectFromArray, createValuesObjectFromAttributes, normalizeToUUID } from './constants';
import { EditProposal } from '@graphprotocol/grc-20/proto'

function reindexRelations(relations) {
  // sort initial relations list
  const sorted = relations.slice().sort((a, b) => a.index.localeCompare(b.index));
  // re-index with fractional indexes and maintain ordering
  for (let i = 0; i < sorted.length; i++) {
    const prev = i === 0 ? null : sorted[i - 1].index;
    const newIndex = Position.generateBetween(prev, null);
    // update your object
    sorted[i].index = newIndex;
  }

  return sorted;
}

const DataTypeMap: Record<string, DataType> = {
  "LckSTmjBrYAJaFcDs89am5": 'TEXT',
  "5xroh3gbWYbWY4oR3nFXzy": 'TEXT',
  "LBdMpTNyycNffsF51t2eSp": 'NUMBER',
  "3mswMrL91GuYTfBq29EuNE": 'TIME',
  "UZBZNbA7Uhx1f8ebLi1Qj5": 'POINT',
  "G9NpD4c7GB7nH5YU9Tesgf": 'CHECKBOX',
  "AKDxovGvZaPSWnmKnSoZJY": 'RELATION',
  "X8KB1uF84RYppghBSVvhqr": 'RELATION',
};


// ----- main -----
//Initialize postgres server
// PostgreSQL connection details
const client = new Client({
    host: 'localhost', // e.g., 'localhost'
    port: 5432, // Default port
    user: 'postgres',
    password: '',
    database: 'postgres',
});
let valuesArray;

try {


    //Get unique space IDs
    //Get unique entity IDs in that space
    //Iterate through all entities
    //Create entity ops where spaceID is the current space
    //Create relation ops where fromEntity is the current entity and spaceID is the current space
    await client.connect();

    const walletAddress = "0xBad154E38B2D2f29f628b42fd08538aF6553af80"
    const ops: Array<Op> = [];
    let addOps;
    

    //find all entity IDs with type property
    const spaces = await client.query(`
        SELECT DISTINCT space_id
        FROM properties
    `);

    console.log(spaces.rows.length);

    //const set_spaces = ["25omwWh6HYgeRQKCaSpVpa","SgjATMbm41LX6naizMqBVd", "LHDnAidYUSBJuvq7wDPRQZ", "D8akqNQr8RMdCdFHecT2n", "BDuZwkjCg3nPWMDshoYtpS", "Qs46y2TuFyVvgVV3QbbVW1", "DqiHGrgbniQ9RXRbcQArQ2", "8YiKaTRpE7M84pkRhVvGF9", "FhC6CtBwyzXoTi8guF1HEi", "ETLCku7ZPvqysA9sHDw58K"] //Root, Crypto, Crypto events, Regions, Crypto News, SF, Industries, Education, Academia, Technology ETLCku7ZPvqysA9sHDw58K
    const set_spaces = ["ETLCku7ZPvqysA9sHDw58K"] //Root, Crypto, Crypto events, Regions, Crypto News, SF, Industries, Education, Academia, Technology ETLCku7ZPvqysA9sHDw58K
    for (const space of set_spaces) { //should be spaces.rows

        //Any entity that has a types relation to property, do create property and map value type to the correct datatype value
        //Ignore the types relations where to_entity is property entity
        //Ignore the properties for value type

        const entities = await client.query(`
            SELECT DISTINCT entity_id AS entity_id
            FROM properties
            WHERE space_id = $1
          
            UNION
          
            SELECT DISTINCT from_entity_id AS entity_id
            FROM relations
            WHERE space_id = $1
          `, [space]); //should be space.space_id
        
        const entityIds = entities.rows.map(row => row.entity_id);
        const uniqueIds = new Set(entityIds);

        if (entityIds.length !== uniqueIds.size) {
        console.log('⚠️ Duplicate entity IDs found');
        } else {
        console.log('✅ All entity IDs are unique');
        }

        for (const entity of entities.rows) {

            const propertyId = "GscJ2GELQjmLoaVrYyR3xm";
            const typesId = "Jfmby78N4BCseZinBmdVov";
            const valueTypeId = "WQfdWjboZWFuTseDhG5Cw1";
            const renderableTypeId = "5LJvjzknoN7HFHLPP9UyqF";
            const nativeTypeId = 'MB3wRFieouFfECQ4d9XYYm';
            const imageId = 'X8KB1uF84RYppghBSVvhqr';
            const urlId = '5xroh3gbWYbWY4oR3nFXzy';
            const typeId = 'VdTsW1mGiy1XSooJaBBLc4';
            //find all entity IDs with type property
            const propertyRelations = await client.query(`
                SELECT *
                FROM relations
                WHERE from_entity_id = $1
                AND to_entity_id = $2
                AND type_id = $3
            `, [entity.entity_id, propertyId, typesId]); //should be space.space_id

            if (propertyRelations.rows.length > 0) {

                const valueTypeRelations = await client.query(`
                    SELECT *
                    FROM relations
                    WHERE from_entity_id = $1
                    AND type_id = $2
                `, [entity.entity_id, valueTypeId]); //should be space.space_id

                if (valueTypeRelations.rows == 0) {

                    console.log("Property with no value type:", entity.entity_id)
                }
                
                const dataType = valueTypeRelations.rows?.[0]?.to_entity_id ? DataTypeMap[valueTypeRelations.rows[0].to_entity_id] : undefined

                if (dataType) {
                    addOps = Graph.createProperty({
                        id: normalizeToUUID(entity.entity_id),
                        dataType: dataType
                    });
                    ops.push(...addOps.ops);
                    // look at geo location
                    if (["5xroh3gbWYbWY4oR3nFXzy", "X8KB1uF84RYppghBSVvhqr"].includes(valueTypeRelations.rows?.[0]?.to_entity_id)) {
                        addOps = Graph.createRelation({
                            fromEntity: normalizeToUUID(entity.entity_id),
                            toEntity: normalizeToUUID(valueTypeRelations.rows?.[0]?.to_entity_id),
                            type: normalizeToUUID(renderableTypeId),
                        });
                        ops.push(...addOps.ops);
                    }

                    if (entity.entity_id == "GSA7HUQwsUbMJQ2RDGNi2W") { // Geo location property
                        addOps = Graph.createRelation({
                            fromEntity: normalizeToUUID(entity.entity_id),
                            toEntity: normalizeToUUID('LPAM1sEzB7XgRx8pAmTD8A'), //Geo location renderable type
                            type: normalizeToUUID(renderableTypeId),
                        });
                        ops.push(...addOps.ops);
                    }
                    if (entity.entity_id == "FAgoYRgSim3ydKxzt5CDr5") { // Address property
                        addOps = Graph.createRelation({
                            fromEntity: normalizeToUUID(entity.entity_id),
                            toEntity: normalizeToUUID('VpEt3UkwX63iBtwfdRafNH'), //Address renderable type
                            type: normalizeToUUID(renderableTypeId),
                        });
                        ops.push(...addOps.ops);
                    }
                    //Do I need to do this for place?
                }
            }

            
            const excludedAttributeIds = [
                "Qx8dASiTNsxxP3rJbd4Lzd", // toProperty
                "RERshk4JoYoMC17r1qAo9J", // fromProperty
                "3WxYoAVreE4qFhkDUs5J3q", // relationTypeProperty
                "WNopXUYxsSsE51gkJGWghe", // indexProperty
                "Jfmby78N4BCseZinBmdVov", // types Note: types shouldnt be a property... therefore it should be excluded. It is used on types relation sometimes.
            ];
                
            const properties = await client.query(`
                SELECT *
                FROM properties
                WHERE entity_id = $1
                    AND space_id = $2
                    AND attribute_id NOT IN (${excludedAttributeIds.map((_, i) => `$${i + 3}`).join(', ')})
            `, [entity.entity_id, space, ...excludedAttributeIds]); //should be space.space_id
        
            valuesArray = createValuesObjectFromAttributes(properties.rows ?? []);
            
            //find all entity IDs with type property
            const relations = await client.query(`
                SELECT *
                FROM relations
                WHERE from_entity_id = $1
                AND space_id = $2
                AND NOT (type_id = $3 AND to_entity_id = $4)
                AND (type_id <> $5)
                AND NOT (from_entity_id = $7 AND type_id = $3 AND to_entity_id = $6)
                AND NOT (from_entity_id = $8 AND type_id = $3 AND to_entity_id = $6)
                AND NOT (from_entity_id = $7 AND type_id = $3 AND to_entity_id = $9)
                AND NOT (from_entity_id = $8 AND type_id = $3 AND to_entity_id = $9)
            `, [entity.entity_id, space, typesId, propertyId, valueTypeId, nativeTypeId, imageId, urlId, typeId]); //should be space.space_id
            
            if (entity.entity_id == 'KAwgXYKACokzn8E1yuwKt4') {
                //console.log(relations.rows)
            }
            
            const relationsArray = createRelationsObjectFromArray(reindexRelations(relations.rows) ?? []);

            if (entity.entity_id == 'KAwgXYKACokzn8E1yuwKt4') {
                //console.log(relationsArray)
            }
            if (normalizeToUUID(entity.entity_id) == '5d16c7f1-48a8-4f98-bea1-4e4861e0f99f') {
                //console.log(entity.entity_id)
                //console.log(properties.rows)
            }
            

            try {
                
                addOps = Graph.createEntity({
                    id: normalizeToUUID(entity.entity_id), // optional and will be generated if not provided
                    values: valuesArray,
                    relations: relationsArray
                });
                ops.push(...addOps.ops);

                //if (entity.entity_id == 'KAwgXYKACokzn8E1yuwKt4') {
                //    console.log(addOps)

                //    let test_ops;
                //    // Convert operations to a readable JSON format
                //    test_ops = JSON.stringify(addOps, null, 2);
                //    // Write to a text file
                //    fs.writeFileSync(`test_ops.txt`, test_ops);
                //}
            }
            catch {
                //console.log("fail at write")
                //console.log(valuesArray)
            }

            
        }

        let outputText;
        // Convert operations to a readable JSON format
        outputText = JSON.stringify(ops, null, 2);
        // Write to a text file
        fs.writeFileSync(`${space}_ops.txt`, outputText);

        const edit = EditProposal.encode({
            name: `Migration for space ${space}`,
            ops: ops,
            author: walletAddress
        });
        const file = Bun.file(`${space}_ops`);
        await Bun.write(file, edit);

        ops.length = 0;
    }

} finally {
    await client.end();
    console.log('Database Closed');
}


//Lower case operators and change attribute to property
//Make a ticket to add formatting to the filters in the UI
//Write a spec for what you might want for nested data block filters (relationEntities?)
//Make a ticket re: new query entity UI
//Make a spec for the render type entity build

//Change entity IDs in the selector values