const { Consumer } = require('sqs-consumer');
const AWS = require('aws-sdk');
const meta = new AWS.MetadataService()
const imageThumbnail = require('image-thumbnail');
const dotenv = require('dotenv');
dotenv.config();

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
async function getInstanceId() {
    return new Promise((resolve, reject) => {
        meta.request("/latest/meta-data/instance-id", function (err, data) {
            if (err) {
                return reject(err)
            }
            resolve(data)
        })
    })
}
const app = Consumer.create({
    queueUrl: process.env.QUEUE_URL,
    handleMessage: async (message) => {
        AWS.config.update({
            region: "ap-northeast-2"
        });

        //이 이벤트를 처리하는 동안은 오토스케일링의 스케일링을 멈춘다.
        //termination protection
        var autoscaling = new AWS.AutoScaling();
        const ec2MetaDAta = await getInstanceId();
        var asgparams1 = {
            AutoScalingGroupName: process.env.ASG_Name,
            InstanceIds: [
                ec2MetaDAta
            ],
            ProtectedFromScaleIn: true
        };
        try {
            await autoscaling.setInstanceProtection(asgparams1).promise();
        }
        catch (e) {
            console.log(e);
        }

        //메세지에 담긴 내용에서 S3 버킷명과 키 이름을 가져와서
        const item = JSON.parse(message.Body).Records[0]
        const s3 = new AWS.S3();

        let bucketName = item.s3.bucket.name;
        let keyName = item.s3.object.key;
        const s3HeadParm = {
            Bucket: bucketName,
            Key: keyName
        }
        console.log(s3HeadParm);
        let metaData = {}
        const data = await s3.headObject(s3HeadParm).promise();
        Object.keys(data.Metadata).map(function (key, idex) {
            metaData[key] = data.Metadata[key];
        }
        );
        var getParams = {
            Bucket: bucketName,
            Key: keyName
        }
        //실제 파일을 가져와서
        const rest = await s3.getObject(getParams).promise();

        //리사이징 후에
        if (rest.Body == undefined || rest.Body.length < 1) {
            var asgparams2 = {
                AutoScalingGroupName: process.env.ASG_Name,
                InstanceIds: [
                    ec2MetaDAta
                ],
                ProtectedFromScaleIn: false
            };
            await autoscaling.setInstanceProtection(asgparams2).promise();
        }
        else {

            const width = 100;
            const height = 200;
            const thumbnail = await imageThumbnail(rest.Body, { width: width, height: height })

            //시간을 기다리고
            // await sleep(1000 * 30 * 1);

            //파일명을 바꾸고(기존 파일명+resized100x100)
            let patt1 = /\.([0-9a-z]+)(?:[\?#]|$)/i;
            let m1 = (keyName).match(patt1);
            let extention = m1[1];
            let orgnName = keyName.replace(/\.[^/.]+$/, "").replace("images/", "")

            //기존 S3 버킷에 resized/ 디렉토리에 다시 업로드한다.
            var param = {
                'Bucket': bucketName,
                'Key': `resized/${orgnName}-resized${width}x${height}.${extention}`,
                'Body': thumbnail,
                Metadata: metaData,
            }

            await s3.upload(param).promise()


            //이후 Autoscaling을 다시 시작한다.
            var asgparams2 = {
                AutoScalingGroupName: process.env.ASG_Name,
                InstanceIds: [
                    ec2MetaDAta
                ],
                ProtectedFromScaleIn: false
            };
            await autoscaling.setInstanceProtection(asgparams2).promise();
        }
    },
});

app.on('error', async (err, message) => {
    var autoscaling = new AWS.AutoScaling();
    const ec2MetaDAta = await getInstanceId();
    var asgparams2 = {
        AutoScalingGroupName: process.env.ASG_Name,
        InstanceIds: [
            ec2MetaDAta
        ],
        ProtectedFromScaleIn: false
    };
    await autoscaling.setInstanceProtection(asgparams2).promise();
    console.error(err.message);
});

app.on('processing_error', async (err, message) => {
    var autoscaling = new AWS.AutoScaling();
    const ec2MetaDAta = await getInstanceId();
    var asgparams2 = {
        AutoScalingGroupName: process.env.ASG_Name,
        InstanceIds: [
            ec2MetaDAta
        ],
        ProtectedFromScaleIn: false
    };
    await autoscaling.setInstanceProtection(asgparams2).promise();
    console.error(err.message);
});

app.start();