import json
import os
import boto3

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']

def lambda_handler(event, context):
    try:
        # Extract jobId from path parameters
        path_params = event.get('pathParameters', {})
        # Note: If CloudFront forwards to FunctionURL, path might be in event['rawPath']
        # The expected path is /result/{jobId}
        raw_path = event.get('rawPath', '')
        job_id = raw_path.split('/')[-1]

        if not job_id:
            return {'statusCode': 400, 'body': json.dumps({'error': 'jobId missing'})}

        table = dynamodb.Table(TABLE_NAME)
        response = table.get_item(Key={'jobId': job_id})
        
        item = response.get('Item')
        if not item:
            return {'statusCode': 404, 'body': json.dumps({'error': 'job not found'})}

        # Return relevant fields
        result = {'status': item.get('status')}
        
        for field in ['bin', 'item', 'reason', 'confidence']:
            if field in item:
                # DynamoDB stores floats as Decimal, convert to float for JSON
                val = item[field]
                from decimal import Decimal
                if isinstance(val, Decimal):
                    val = float(val)
                result[field] = val

        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
