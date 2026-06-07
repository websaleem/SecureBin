import json
import os
import urllib.parse
import base64
import boto3

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime', region_name='ap-southeast-2')

TABLE_NAME = os.environ['TABLE_NAME']
MODEL_ID = 'apac.anthropic.claude-3-5-haiku-20241022-v1:0'

def lambda_handler(event, context):
    try:
        # Process S3 Event
        for record in event['Records']:
            bucket = record['s3']['bucket']['name']
            key = urllib.parse.unquote_plus(record['s3']['object']['key'])
            
            # Extract jobId from key (uploads/{jobId}.jpeg)
            job_id = key.split('/')[-1].split('.')[0]
            
            table = dynamodb.Table(TABLE_NAME)
            
            # Get job metadata (state, council)
            response = table.get_item(Key={'jobId': job_id})
            item = response.get('Item')
            
            if not item:
                print(f"Job {job_id} not found in DB")
                continue
                
            state = item.get('state', '')
            council = item.get('council', '')
            
            # Fetch image from S3
            s3_obj = s3.get_object(Bucket=bucket, Key=key)
            image_bytes = s3_obj['Body'].read()
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            
            # Build Bedrock Prompt
            system_prompt = f"You are an expert waste sorting assistant."
            if state and council:
                system_prompt += f" The user is in {council}, {state}, Australia. Apply {council}'s specific bin collection rules."
                
            prompt_text = (
                "Identify the main waste item in the image and determine which bin it belongs to.\n"
                "Return ONLY a JSON object with the following keys:\n"
                "- bin: exactly one of [red, yellow, green, white, purple, blue, orange, grey]\n"
                "- item: brief name of the item\n"
                "- reason: short explanation of why it goes in this bin\n"
                "- confidence: number between 0 and 1\n"
            )

            # Call Amazon Bedrock (Claude 3.5 Haiku)
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 512,
                "system": system_prompt,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": image_base64
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt_text
                            }
                        ]
                    }
                ]
            })

            bedrock_resp = bedrock_runtime.invoke_model(
                modelId=MODEL_ID,
                contentType='application/json',
                accept='application/json',
                body=body
            )

            response_body = json.loads(bedrock_resp['body'].read())
            ai_text = response_body.get('content', [{}])[0].get('text', '')
            
            # Parse AI JSON response
            try:
                # Sometimes Claude wraps json in ```json ... ```
                if "```json" in ai_text:
                    ai_text = ai_text.split("```json")[1].split("```")[0]
                result = json.loads(ai_text)
            except Exception as e:
                print(f"Failed to parse Bedrock response as JSON: {ai_text}")
                table.update_item(
                    Key={'jobId': job_id},
                    UpdateExpression='SET #st = :failed',
                    ExpressionAttributeNames={'#st': 'status'},
                    ExpressionAttributeValues={':failed': 'failed'}
                )
                continue

            # Write result to DynamoDB
            from decimal import Decimal
            conf = Decimal(str(result.get('confidence', 0.0)))
            
            table.update_item(
                Key={'jobId': job_id},
                UpdateExpression='SET #st = :done, #bin = :bin, #item = :item, #reason = :reason, #conf = :conf',
                ExpressionAttributeNames={
                    '#st': 'status',
                    '#bin': 'bin',
                    '#item': 'item',
                    '#reason': 'reason',
                    '#conf': 'confidence'
                },
                ExpressionAttributeValues={
                    ':done': 'done',
                    ':bin': result.get('bin', 'grey'),
                    ':item': result.get('item', 'Unknown item'),
                    ':reason': result.get('reason', ''),
                    ':conf': conf
                }
            )
            
            # Delete object from S3 after processing
            s3.delete_object(Bucket=bucket, Key=key)
            
        return {'statusCode': 200, 'body': 'Processed successfully'}
    except Exception as e:
        print(f"Error: {str(e)}")
        raise e
